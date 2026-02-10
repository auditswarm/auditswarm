/**
 * Backfill TransactionFlow records from existing transactions.
 *
 * Reads rawData.accountData to extract precise per-mint net balance changes
 * for the wallet owner, then inserts TransactionFlow rows.
 *
 * Usage: npx tsx scripts/backfill-flows.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_DECIMALS = 9;

const STABLECOIN_MINTS = new Set([
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

interface FlowRecord {
  transactionId: string;
  walletId: string;
  mint: string;
  decimals: number;
  rawAmount: string;
  amount: Prisma.Decimal;
  direction: string;
  valueUsd: Prisma.Decimal | null;
}

function extractFlows(
  txId: string,
  walletId: string,
  walletAddress: string,
  rawData: any,
  txType: string,
  totalValueUsd: number,
  fee: bigint,
  feePayer: string,
): FlowRecord[] {
  const flows: FlowRecord[] = [];
  const accountData: any[] = rawData?.accountData;
  if (!accountData?.length) return flows;

  const walletAddr = walletAddress.toLowerCase();

  // --- SOL flow ---
  for (const ad of accountData) {
    if ((ad.account ?? '').toLowerCase() !== walletAddr) continue;

    // Use raw nativeBalanceChange — includes fee deductions, matches on-chain balance
    const solDeltaLamports = BigInt(Math.round(ad.nativeBalanceChange ?? 0));

    if (solDeltaLamports !== 0n) {
      const absLamports = solDeltaLamports < 0n ? -solDeltaLamports : solDeltaLamports;
      const direction = solDeltaLamports > 0n ? 'IN' : 'OUT';
      const humanAmount = new Prisma.Decimal(absLamports.toString()).div(
        new Prisma.Decimal(10).pow(SOL_DECIMALS),
      );

      flows.push({
        transactionId: txId,
        walletId,
        mint: SOL_MINT,
        decimals: SOL_DECIMALS,
        rawAmount: absLamports.toString(),
        amount: humanAmount,
        direction,
        valueUsd: null, // set below
      });
    }
    break;
  }

  // --- SPL token flows ---
  for (const ad of accountData) {
    for (const tbc of ad.tokenBalanceChanges ?? []) {
      if ((tbc.userAccount ?? '').toLowerCase() !== walletAddr) continue;

      const mint: string = tbc.mint ?? '';
      if (!mint) continue;

      const rawStr: string = tbc.rawTokenAmount?.tokenAmount ?? '0';
      const decimals: number = tbc.rawTokenAmount?.decimals ?? 0;

      let rawDelta: bigint;
      try {
        rawDelta = BigInt(rawStr);
      } catch {
        continue;
      }
      if (rawDelta === 0n) continue;

      const absRaw = rawDelta < 0n ? -rawDelta : rawDelta;
      const direction = rawDelta > 0n ? 'IN' : 'OUT';
      const humanAmount = new Prisma.Decimal(absRaw.toString()).div(
        new Prisma.Decimal(10).pow(decimals),
      );

      flows.push({
        transactionId: txId,
        walletId,
        mint,
        decimals,
        rawAmount: absRaw.toString(),
        amount: humanAmount,
        direction,
        valueUsd: null,
      });
    }
  }

  // --- USD attribution ---
  if (flows.length > 0 && totalValueUsd > 0) {
    attributeUsd(flows, txType, totalValueUsd);
  }

  return flows;
}

function attributeUsd(flows: FlowRecord[], txType: string, totalValueUsd: number): void {
  const stableFlow = flows.find(f => STABLECOIN_MINTS.has(f.mint));

  if (txType === 'SWAP') {
    if (stableFlow) {
      // Stablecoin present: stablecoin flow valueUsd = its amount; other flow = stablecoin amount
      const stableAmount = Number(stableFlow.amount.toString());
      for (const f of flows) {
        if (STABLECOIN_MINTS.has(f.mint)) {
          f.valueUsd = new Prisma.Decimal(Number(f.amount.toString()).toFixed(8));
        } else {
          f.valueUsd = new Prisma.Decimal(stableAmount.toFixed(8));
        }
      }
    } else {
      // No stablecoin: all flows get totalValueUsd
      for (const f of flows) {
        f.valueUsd = new Prisma.Decimal(totalValueUsd.toFixed(8));
      }
    }
  } else {
    // Non-swap: each flow gets totalValueUsd
    for (const f of flows) {
      f.valueUsd = new Prisma.Decimal(totalValueUsd.toFixed(8));
    }
  }
}

async function main() {
  const prisma = new PrismaClient();
  await prisma.$connect();

  console.log('Starting TransactionFlow backfill...');

  // Check how many flows already exist
  const existingCount = await prisma.transactionFlow.count();
  console.log(`Existing flows: ${existingCount}`);

  // Get wallet address map
  const wallets = await prisma.wallet.findMany({ select: { id: true, address: true } });
  const walletAddrMap = new Map<string, string>();
  for (const w of wallets) walletAddrMap.set(w.id, w.address);
  console.log(`Found ${wallets.length} wallets`);

  // Process transactions in batches
  const BATCH_SIZE = 500;
  let offset = 0;
  let totalProcessed = 0;
  let totalFlows = 0;

  while (true) {
    const transactions = await prisma.transaction.findMany({
      select: {
        id: true,
        walletId: true,
        type: true,
        totalValueUsd: true,
        rawData: true,
        fee: true,
        feePayer: true,
      },
      orderBy: { timestamp: 'asc' },
      skip: offset,
      take: BATCH_SIZE,
    });

    if (transactions.length === 0) break;

    const flowBatch: Prisma.TransactionFlowCreateManyInput[] = [];

    for (const tx of transactions) {
      const walletAddress = walletAddrMap.get(tx.walletId);
      if (!walletAddress) continue;

      const rawData = tx.rawData as any;
      if (!rawData?.accountData?.length) continue;

      const totalValueUsd = tx.totalValueUsd ? Number(tx.totalValueUsd) : 0;

      const flows = extractFlows(
        tx.id,
        tx.walletId,
        walletAddress,
        rawData,
        tx.type,
        totalValueUsd,
        tx.fee,
        tx.feePayer,
      );

      for (const f of flows) {
        flowBatch.push({
          id: crypto.randomUUID(),
          transactionId: f.transactionId,
          walletId: f.walletId,
          mint: f.mint,
          decimals: f.decimals,
          rawAmount: f.rawAmount,
          amount: f.amount,
          direction: f.direction,
          valueUsd: f.valueUsd,
        });
      }
    }

    if (flowBatch.length > 0) {
      const result = await prisma.transactionFlow.createMany({
        data: flowBatch,
        skipDuplicates: true,
      });
      totalFlows += result.count;
    }

    totalProcessed += transactions.length;
    offset += BATCH_SIZE;

    if (totalProcessed % 1000 === 0 || transactions.length < BATCH_SIZE) {
      console.log(`Processed ${totalProcessed} transactions, created ${totalFlows} flows`);
    }
  }

  console.log(`\nBackfill complete: ${totalProcessed} transactions -> ${totalFlows} flows`);

  // Quick sanity check: SOL holdings
  const solCheck = await prisma.$queryRaw<{ net: string }[]>`
    SELECT (
      SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END)
    )::text AS net
    FROM transaction_flows
    WHERE mint = ${SOL_MINT}
  `;
  if (solCheck[0]) {
    console.log(`SOL net balance from flows: ${solCheck[0].net}`);
  }

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
