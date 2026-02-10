/**
 * Backfill exchange transaction data:
 * 1. Re-resolve exchange flow mints via seeded TokenSymbolMapping table
 * 2. Recompute USD values using stablecoin detection + rawData extraction
 * 3. Rebuild transfers JSON from flows
 * 4. Re-classify on-chain UNKNOWN transactions with transfers
 *
 * Usage: cd auditswarm/backend && NODE_PATH=libs/database/node_modules npx tsx scripts/backfill-exchange-data.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const STABLECOINS = new Set([
  'USDT', 'USDC', 'BUSD', 'FDUSD', 'USD1', 'DAI', 'TUSD', 'USDP', 'GUSD', 'FRAX',
  'PYUSD', 'USDD', 'CUSD', 'SUSD', 'LUSD', 'EURC', 'AEUR',
]);

function isUsdLike(symbol: string): boolean {
  return STABLECOINS.has(symbol.toUpperCase()) || symbol.toUpperCase() === 'USD';
}

// ============================================
// Phase 1: Re-resolve exchange flow mints
// ============================================

async function backfillExchangeFlowMints() {
  console.log('\n=== Phase 1: Re-resolve exchange flow mints ===');

  // Get all flows with pseudo-mints (exchange:XXX)
  const pseudoFlows = await prisma.transactionFlow.findMany({
    where: { mint: { startsWith: 'exchange:' } },
    select: { id: true, mint: true, symbol: true, network: true },
  });

  console.log(`Found ${pseudoFlows.length} flows with pseudo-mints`);
  let resolved = 0;

  for (const flow of pseudoFlows) {
    const symbol = flow.symbol ?? flow.mint.replace('exchange:', '');

    // Try to find a mapping
    const mapping = flow.network
      ? await prisma.tokenSymbolMapping.findUnique({
          where: { symbol_network: { symbol: symbol.toUpperCase(), network: flow.network } },
        })
      : await prisma.tokenSymbolMapping.findFirst({
          where: { symbol: symbol.toUpperCase(), isDefault: true },
        });

    if (!mapping) {
      // Try any match
      const anyMapping = await prisma.tokenSymbolMapping.findFirst({
        where: { symbol: symbol.toUpperCase() },
      });
      if (!anyMapping) continue;

      await prisma.transactionFlow.update({
        where: { id: flow.id },
        data: { mint: anyMapping.mint, decimals: anyMapping.decimals },
      });
      resolved++;
    } else {
      await prisma.transactionFlow.update({
        where: { id: flow.id },
        data: { mint: mapping.mint, decimals: mapping.decimals },
      });
      resolved++;
    }
  }

  console.log(`Resolved ${resolved}/${pseudoFlows.length} pseudo-mints`);
}

// ============================================
// Phase 2: Recompute USD values on exchange flows
// ============================================

async function backfillExchangeFlowPrices() {
  console.log('\n=== Phase 2: Recompute USD values on exchange flows ===');

  // Get flows missing prices
  const flowsMissingPrice = await prisma.transactionFlow.findMany({
    where: {
      exchangeConnectionId: { not: null },
      priceAtExecution: null,
    },
    select: { id: true, symbol: true, amount: true },
  });

  console.log(`Found ${flowsMissingPrice.length} exchange flows without priceAtExecution`);
  let updated = 0;

  for (const flow of flowsMissingPrice) {
    if (flow.symbol && isUsdLike(flow.symbol)) {
      const amount = Number(flow.amount);
      await prisma.transactionFlow.update({
        where: { id: flow.id },
        data: {
          priceAtExecution: new Prisma.Decimal('1.00000000'),
          valueUsd: new Prisma.Decimal(amount.toFixed(8)),
        },
      });
      updated++;
    }
  }

  console.log(`Set stablecoin price ($1) on ${updated} flows`);
}

// ============================================
// Phase 3: Recompute totalValueUsd + transfers on exchange transactions
// ============================================

async function backfillExchangeTransactions() {
  console.log('\n=== Phase 3: Rebuild totalValueUsd + transfers on exchange transactions ===');

  const exchangeTxs = await prisma.transaction.findMany({
    where: { source: 'EXCHANGE' },
    include: { flows: true },
  });

  console.log(`Processing ${exchangeTxs.length} exchange transactions`);
  let updatedValue = 0;
  let updatedTransfers = 0;

  for (const tx of exchangeTxs) {
    const updates: any = {};

    // Rebuild transfers JSON from flows
    const transfers = tx.flows.map(f => ({
      mint: f.mint,
      symbol: f.symbol,
      amount: Number(f.amount),
      direction: f.direction,
      from: f.direction === 'OUT' ? `exchange:${tx.exchangeName}` : 'external',
      to: f.direction === 'IN' ? `exchange:${tx.exchangeName}` : 'external',
      valueUsd: f.valueUsd ? Number(f.valueUsd) : undefined,
      isFee: f.isFee,
      priceAtExecution: f.priceAtExecution ? Number(f.priceAtExecution) : undefined,
    }));

    const currentTransfers = tx.transfers as any[];
    if (!currentTransfers || !Array.isArray(currentTransfers) || currentTransfers.length === 0) {
      updates.transfers = transfers;
      updatedTransfers++;
    }

    // Recompute totalValueUsd from flows
    const nonFeeFlows = tx.flows.filter(f => !f.isFee);
    const withValue = nonFeeFlows.filter(f => f.valueUsd !== null);

    if (withValue.length > 0) {
      const total = withValue.reduce(
        (sum, f) => sum.add(f.valueUsd!),
        new Prisma.Decimal(0),
      );
      if (tx.totalValueUsd === null || tx.totalValueUsd.eq(0)) {
        updates.totalValueUsd = total;
        updatedValue++;
      }
    } else if (tx.totalValueUsd === null) {
      // Try extracting from rawData
      const usd = extractUsdFromRawData(tx);
      if (usd !== null && usd > 0) {
        updates.totalValueUsd = new Prisma.Decimal(usd.toFixed(8));
        updatedValue++;
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: updates,
      });
    }
  }

  console.log(`Updated totalValueUsd on ${updatedValue} transactions`);
  console.log(`Rebuilt transfers JSON on ${updatedTransfers} transactions`);
}

function extractUsdFromRawData(tx: any): number | null {
  const raw = tx.rawData as any;
  if (!raw) return null;

  const type = tx.type;

  if (type === 'EXCHANGE_TRADE' || type === 'EXCHANGE_C2C_TRADE') {
    if (raw.quoteQty) {
      // Check if trade pair uses USD-like quote
      const symbol = raw.symbol ?? '';
      const knownQuotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'USD'];
      for (const q of knownQuotes) {
        if (symbol.endsWith(q)) {
          return parseFloat(raw.quoteQty);
        }
      }
    }
    return null;
  }

  if (type === 'EXCHANGE_DEPOSIT' || type === 'EXCHANGE_WITHDRAWAL') {
    const coin = raw.coin ?? raw.asset ?? '';
    if (isUsdLike(coin) && raw.amount) {
      return Math.abs(parseFloat(raw.amount));
    }
    return null;
  }

  if (type === 'EXCHANGE_CONVERT') {
    if (raw.toAsset && isUsdLike(raw.toAsset) && raw.toAmount) {
      return parseFloat(raw.toAmount);
    }
    if (raw.fromAsset && isUsdLike(raw.fromAsset) && raw.fromAmount) {
      return parseFloat(raw.fromAmount);
    }
    return null;
  }

  if (type === 'EXCHANGE_STAKE' || type === 'EXCHANGE_UNSTAKE' ||
      type === 'EXCHANGE_INTEREST' || type === 'EXCHANGE_DIVIDEND') {
    const asset = raw.asset ?? '';
    if (isUsdLike(asset) && raw.amount) {
      return Math.abs(parseFloat(raw.amount));
    }
    return null;
  }

  if (type === 'EXCHANGE_FIAT_BUY' || type === 'EXCHANGE_FIAT_SELL') {
    if (raw.sourceAmount) return parseFloat(raw.sourceAmount);
    return null;
  }

  return null;
}

// ============================================
// Phase 4: Re-classify on-chain UNKNOWN transactions
// ============================================

async function backfillOnChainClassification() {
  console.log('\n=== Phase 4: Re-classify on-chain UNKNOWN transactions ===');

  const unknownTxs = await prisma.transaction.findMany({
    where: {
      source: 'ONCHAIN',
      type: 'UNKNOWN',
    },
    select: {
      id: true,
      walletId: true,
      rawData: true,
      transfers: true,
    },
  });

  console.log(`Found ${unknownTxs.length} UNKNOWN on-chain transactions`);
  let reclassified = 0;
  let transfersRebuilt = 0;

  for (const tx of unknownTxs) {
    const raw = tx.rawData as any;
    if (!raw) continue;

    const walletId = tx.walletId;
    if (!walletId) continue;

    // Get wallet address for direction resolution
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { address: true },
    });
    if (!wallet) continue;

    const walletAddress = wallet.address.toLowerCase();
    const transfers: any[] = [];

    // Extract native SOL transfers
    const nativeTransfers = raw.nativeTransfers ?? [];
    for (const nt of nativeTransfers) {
      const from = nt.fromUserAccount ?? nt.from ?? '';
      const to = nt.toUserAccount ?? nt.to ?? '';
      const amount = (nt.amount ?? 0) / 1e9;
      if (amount === 0) continue;

      const direction = to.toLowerCase() === walletAddress ? 'IN' : 'OUT';
      transfers.push({
        mint: 'So11111111111111111111111111111111111111112',
        amount,
        direction,
        from,
        to,
      });
    }

    // Extract SPL token transfers
    const tokenTransfers = raw.tokenTransfers ?? [];
    for (const tt of tokenTransfers) {
      const from = tt.fromUserAccount ?? tt.fromTokenAccount ?? '';
      const to = tt.toUserAccount ?? tt.toTokenAccount ?? '';
      const amount = tt.tokenAmount ?? 0;
      if (amount === 0) continue;

      const direction = to.toLowerCase() === walletAddress ? 'IN' : 'OUT';
      transfers.push({
        mint: tt.mint ?? '',
        amount,
        direction,
        from,
        to,
      });
    }

    if (transfers.length === 0) continue;

    // Direction-based classification
    const relevant = transfers.filter(
      (t: any) => t.from.toLowerCase() === walletAddress || t.to.toLowerCase() === walletAddress,
    );

    let newType = 'UNKNOWN';
    const hasIn = relevant.some((t: any) => t.to.toLowerCase() === walletAddress);
    const hasOut = relevant.some((t: any) => t.from.toLowerCase() === walletAddress);

    if (hasIn && hasOut) newType = 'SWAP';
    else if (hasIn) newType = 'TRANSFER_IN';
    else if (hasOut) newType = 'TRANSFER_OUT';

    const updates: any = {};
    if (newType !== 'UNKNOWN') {
      updates.type = newType;
      reclassified++;
    }

    // Update transfers JSON if empty
    const currentTransfers = tx.transfers as any[];
    if (!currentTransfers || !Array.isArray(currentTransfers) || currentTransfers.length === 0) {
      if (transfers.length > 0) {
        updates.transfers = transfers;
        transfersRebuilt++;
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: updates,
      });
    }
  }

  console.log(`Reclassified ${reclassified} UNKNOWN → TRANSFER_IN/OUT/SWAP`);
  console.log(`Rebuilt transfers on ${transfersRebuilt} on-chain transactions`);
}

// ============================================
// Phase 5: Create missing on-chain flows from transfers
// ============================================

async function backfillOnChainFlows() {
  console.log('\n=== Phase 5: Create missing on-chain flows from transfers ===');

  // Find on-chain transactions that have transfers but no flows
  const txsWithTransfersNoFlows = await prisma.$queryRaw<any[]>`
    SELECT t.id, t."walletId", t.transfers
    FROM transactions t
    LEFT JOIN transaction_flows tf ON tf."transactionId" = t.id
    WHERE t.source = 'ONCHAIN'
      AND t.transfers IS NOT NULL
      AND jsonb_array_length(t.transfers::jsonb) > 0
      AND tf.id IS NULL
  `;

  console.log(`Found ${txsWithTransfersNoFlows.length} on-chain transactions with transfers but no flows`);
  let created = 0;

  for (const tx of txsWithTransfersNoFlows) {
    const transfers = tx.transfers as any[];
    if (!Array.isArray(transfers) || transfers.length === 0) continue;

    const flowData = transfers.map((t: any) => {
      const mint = t.mint ?? 'So11111111111111111111111111111111111111112';
      const isSol = mint === 'So11111111111111111111111111111111111111112';
      const decimals = isSol ? 9 : 6; // default to 6 for SPL
      const amount = Math.abs(t.amount ?? 0);
      const rawAmount = Math.round(amount * Math.pow(10, decimals)).toString();

      return {
        transactionId: tx.id,
        walletId: tx.walletId,
        mint,
        decimals,
        rawAmount,
        amount: new Prisma.Decimal(amount.toFixed(Math.min(decimals, 18))),
        direction: t.direction ?? 'IN',
        valueUsd: null as Prisma.Decimal | null,
      };
    });

    if (flowData.length > 0) {
      await prisma.transactionFlow.createMany({
        data: flowData,
        skipDuplicates: true,
      });
      created += flowData.length;
    }
  }

  console.log(`Created ${created} new on-chain flows`);
}

// ============================================
// Main
// ============================================

async function main() {
  console.log('Starting data backfill...\n');

  const startTime = Date.now();

  await backfillExchangeFlowMints();
  await backfillExchangeFlowPrices();
  await backfillExchangeTransactions();
  await backfillOnChainClassification();
  await backfillOnChainFlows();

  // Final stats
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Backfill complete in ${elapsed}s ===`);

  const stats = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN source = 'EXCHANGE' THEN 1 END) as exchange,
      COUNT(CASE WHEN source = 'ONCHAIN' THEN 1 END) as onchain,
      COUNT(CASE WHEN "totalValueUsd" IS NOT NULL THEN 1 END) as with_usd,
      COUNT(CASE WHEN type = 'UNKNOWN' THEN 1 END) as unknown,
      COUNT(CASE WHEN transfers IS NOT NULL AND jsonb_array_length(transfers::jsonb) > 0 THEN 1 END) as with_transfers
    FROM transactions
  `;

  const flowStats = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN "valueUsd" IS NOT NULL THEN 1 END) as with_usd,
      COUNT(CASE WHEN "priceAtExecution" IS NOT NULL THEN 1 END) as with_price,
      COUNT(CASE WHEN mint LIKE 'exchange:%' THEN 1 END) as pseudo_mints
    FROM transaction_flows
  `;

  console.log('\nTransaction stats:', stats[0]);
  console.log('Flow stats:', flowStats[0]);
}

main()
  .catch((e) => {
    console.error('Backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
