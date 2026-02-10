/**
 * Address-based reconciliation: Links on-chain sends/receives with exchange deposits/withdrawals
 *
 * Strategy A: Classify by destination address
 *   If TRANSFER_OUT destination = known exchange deposit address → TRANSFER_TO_EXCHANGE
 *   (doesn't require matching EXCHANGE_DEPOSIT record — handles API history limits)
 *
 * Strategy B: Link by txId
 *   Exchange deposit/withdrawal rawData.txId = on-chain transaction signature → bidirectional link
 *
 * Strategy C: Link withdrawal by destination address
 *   Exchange withdrawal rawData.address = our wallet address → link to TRANSFER_IN
 *
 * Usage:
 *   cd backend
 *   NODE_PATH=libs/database/node_modules npx tsx scripts/reconcile-by-address.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function extractAndSaveDepositAddresses() {
  console.log('=== Step 1: Extract deposit addresses → KnownAddress ===');

  const depositAddrs = await prisma.$queryRaw<Array<{
    address: string; coin: string; network: string; exchangeName: string; count: number;
  }>>`
    SELECT DISTINCT
      "rawData"->>'address' as address,
      "rawData"->>'coin' as coin,
      "rawData"->>'network' as network,
      "exchangeName" as "exchangeName",
      COUNT(*)::int as count
    FROM transactions
    WHERE "type" = 'EXCHANGE_DEPOSIT'
      AND "rawData"->>'address' IS NOT NULL
    GROUP BY "rawData"->>'address', "rawData"->>'coin', "rawData"->>'network', "exchangeName"
  `;

  console.log(`Found ${depositAddrs.length} unique deposit address combos`);

  const uniqueAddresses = new Set<string>();
  let saved = 0;

  for (const d of depositAddrs) {
    if (!d.address || uniqueAddresses.has(d.address)) continue;
    uniqueAddresses.add(d.address);

    const existing = await prisma.knownAddress.findUnique({
      where: { address: d.address },
    });

    if (!existing) {
      await prisma.knownAddress.create({
        data: {
          address: d.address,
          name: `${d.exchangeName} Deposit`,
          label: `${d.exchangeName.toUpperCase()}_DEPOSIT_${d.network}`,
          entityType: 'EXCHANGE',
          source: 'SYNC',
          isVerified: true,
          metadata: {
            exchangeName: d.exchangeName,
            network: d.network,
            coins: [d.coin],
            depositCount: d.count,
          },
        },
      });
      saved++;
      console.log(`  Saved: ${d.address.slice(0, 16)}... (${d.exchangeName}/${d.network})`);
    }
  }

  console.log(`Saved ${saved} new KnownAddress entries\n`);
  return [...uniqueAddresses];
}

async function classifyByDestination(depositAddresses: string[]) {
  console.log('=== Step 2: Classify TRANSFER_OUTs by destination address ===');

  let classified = 0;

  for (const addr of depositAddresses) {
    const pattern = '%' + addr + '%';

    // Find on-chain sends to this address that aren't yet classified as TRANSFER_TO_EXCHANGE
    const sends = await prisma.$queryRaw<Array<{
      id: string; signature: string; timestamp: Date; totalValueUsd: any;
      category: string | null; classificationStatus: string | null;
    }>>`
      SELECT "id", "signature", "timestamp", "totalValueUsd", "category", "classificationStatus"
      FROM transactions
      WHERE "source" = 'ONCHAIN'
        AND "type" IN ('TRANSFER_OUT', 'UNKNOWN')
        AND "transfers"::text LIKE ${pattern}
        AND ("category" IS NULL OR "category" != 'TRANSFER_TO_EXCHANGE')
    `;

    if (sends.length === 0) continue;
    console.log(`  Deposit addr ${addr.slice(0, 16)}...: ${sends.length} sends to classify`);

    for (const s of sends) {
      await prisma.transaction.update({
        where: { id: s.id },
        data: {
          category: 'TRANSFER_TO_EXCHANGE',
          classificationStatus: 'AUTO_RESOLVED',
        },
      });
      classified++;
      const date = new Date(s.timestamp).toISOString().slice(0, 10);
      const val = Number(s.totalValueUsd || 0).toFixed(2);
      console.log(`    ${s.signature?.slice(0, 16)}... ${date} $${val} → TRANSFER_TO_EXCHANGE`);
    }
  }

  console.log(`\nClassified ${classified} transactions as TRANSFER_TO_EXCHANGE\n`);
  return classified;
}

async function linkByTxId() {
  console.log('=== Step 3: Link exchange transactions by txId ===');

  let linked = 0;

  // Deposits: rawData.txId should match on-chain signature
  const deposits = await prisma.$queryRaw<Array<{
    id: string; timestamp: Date; rawData: any; linkedTransactionId: string | null;
  }>>`
    SELECT "id", "timestamp", "rawData", "linkedTransactionId"
    FROM transactions
    WHERE "type" = 'EXCHANGE_DEPOSIT'
      AND "linkedTransactionId" IS NULL
      AND "rawData"->>'txId' IS NOT NULL
      AND "rawData"->>'txId' != ''
  `;

  console.log(`  Checking ${deposits.length} deposits with txId...`);

  for (const dep of deposits) {
    const txId = (dep.rawData as any)?.txId;
    if (!txId) continue;

    const match = await prisma.transaction.findFirst({
      where: { signature: txId, source: 'ONCHAIN' },
      select: { id: true, linkedTransactionId: true },
    });

    if (match && !match.linkedTransactionId) {
      await prisma.$transaction([
        prisma.transaction.update({
          where: { id: dep.id },
          data: { linkedTransactionId: match.id },
        }),
        prisma.transaction.update({
          where: { id: match.id },
          data: {
            linkedTransactionId: dep.id,
            category: 'TRANSFER_TO_EXCHANGE',
            classificationStatus: 'AUTO_RESOLVED',
          },
        }),
      ]);
      linked++;
      console.log(`    LINKED deposit: ${txId.slice(0, 20)}...`);
    }
  }

  // Withdrawals: rawData.txId should match on-chain signature
  const withdrawals = await prisma.$queryRaw<Array<{
    id: string; timestamp: Date; rawData: any; linkedTransactionId: string | null;
  }>>`
    SELECT "id", "timestamp", "rawData", "linkedTransactionId"
    FROM transactions
    WHERE "type" = 'EXCHANGE_WITHDRAWAL'
      AND "linkedTransactionId" IS NULL
      AND "rawData"->>'txId' IS NOT NULL
      AND "rawData"->>'txId' != ''
  `;

  console.log(`  Checking ${withdrawals.length} withdrawals with txId...`);

  for (const wd of withdrawals) {
    const txId = (wd.rawData as any)?.txId;
    if (!txId) continue;

    const match = await prisma.transaction.findFirst({
      where: { signature: txId, source: 'ONCHAIN' },
      select: { id: true, linkedTransactionId: true },
    });

    if (match && !match.linkedTransactionId) {
      await prisma.$transaction([
        prisma.transaction.update({
          where: { id: wd.id },
          data: { linkedTransactionId: match.id },
        }),
        prisma.transaction.update({
          where: { id: match.id },
          data: {
            linkedTransactionId: wd.id,
            category: 'TRANSFER_FROM_EXCHANGE',
            classificationStatus: 'AUTO_RESOLVED',
          },
        }),
      ]);
      linked++;
      console.log(`    LINKED withdrawal: ${txId.slice(0, 20)}...`);
    }
  }

  console.log(`\nLinked ${linked} transactions by txId\n`);
  return linked;
}

async function linkWithdrawalsByAddress() {
  console.log('=== Step 4: Link withdrawals by destination = our wallet ===');

  const wallets = await prisma.wallet.findMany({ select: { address: true, id: true, label: true } });
  const walletMap = new Map(wallets.map(w => [w.address, w]));

  let linked = 0;

  for (const [walletAddr, wallet] of walletMap) {
    // Find withdrawals to this wallet
    const withdrawals = await prisma.$queryRaw<Array<{
      id: string; timestamp: Date; totalValueUsd: any; rawData: any; linkedTransactionId: string | null;
    }>>`
      SELECT "id", "timestamp", "totalValueUsd", "rawData", "linkedTransactionId"
      FROM transactions
      WHERE "type" = 'EXCHANGE_WITHDRAWAL'
        AND "linkedTransactionId" IS NULL
        AND "rawData"->>'address' = ${walletAddr}
    `;

    if (withdrawals.length === 0) continue;
    console.log(`  Wallet ${wallet.label || walletAddr.slice(0, 12)}...: ${withdrawals.length} withdrawals`);

    for (const wd of withdrawals) {
      const wdTime = new Date(wd.timestamp).getTime();
      const wdValue = Number(wd.totalValueUsd || 0);

      // Find TRANSFER_IN within 4-hour window with similar value
      const candidates = await prisma.$queryRaw<Array<{
        id: string; timestamp: Date; totalValueUsd: any; linkedTransactionId: string | null;
      }>>`
        SELECT "id", "timestamp", "totalValueUsd", "linkedTransactionId"
        FROM transactions
        WHERE "source" = 'ONCHAIN'
          AND "type" = 'TRANSFER_IN'
          AND "walletId" = ${wallet.id}
          AND "linkedTransactionId" IS NULL
          AND "timestamp" BETWEEN ${new Date(wdTime - 4 * 3600_000)} AND ${new Date(wdTime + 4 * 3600_000)}
        ORDER BY ABS(EXTRACT(EPOCH FROM "timestamp" - ${wd.timestamp}::timestamp))
        LIMIT 5
      `;

      for (const cand of candidates) {
        if (cand.linkedTransactionId) continue;
        const candValue = Number(cand.totalValueUsd || 0);
        const amountDiff = wdValue > 0
          ? Math.abs(wdValue - candValue) / Math.max(wdValue, 0.01)
          : 0;

        if (amountDiff <= 0.10) {
          await prisma.$transaction([
            prisma.transaction.update({
              where: { id: wd.id },
              data: { linkedTransactionId: cand.id },
            }),
            prisma.transaction.update({
              where: { id: cand.id },
              data: {
                linkedTransactionId: wd.id,
                category: 'TRANSFER_FROM_EXCHANGE',
                classificationStatus: 'AUTO_RESOLVED',
              },
            }),
          ]);
          linked++;
          const date = new Date(wd.timestamp).toISOString().slice(0, 10);
          console.log(`    LINKED: withdrawal ${date} $${wdValue.toFixed(2)} ↔ TRANSFER_IN $${candValue.toFixed(2)}`);
          break;
        }
      }
    }
  }

  console.log(`\nLinked ${linked} withdrawal ↔ TRANSFER_IN pairs\n`);
  return linked;
}

async function main() {
  try {
    const depositAddrs = await extractAndSaveDepositAddresses();
    const classified = await classifyByDestination(depositAddrs);
    const txIdLinks = await linkByTxId();
    const addrLinks = await linkWithdrawalsByAddress();

    // Summary
    const totalLinked = await prisma.transaction.count({
      where: { linkedTransactionId: { not: null } },
    });
    const totalClassified = await prisma.transaction.count({
      where: { classificationStatus: { not: null } },
    });
    const total = await prisma.transaction.count();

    console.log('═══════════════════════════════════════════════');
    console.log('  RECONCILIATION SUMMARY');
    console.log('═══════════════════════════════════════════════');
    console.log(`  Classified by address: ${classified}`);
    console.log(`  Linked by txId: ${txIdLinks}`);
    console.log(`  Linked by withdrawal address: ${addrLinks}`);
    console.log(`  Total linked transactions: ${totalLinked}`);
    console.log(`  Overall classification: ${totalClassified}/${total} (${(totalClassified / total * 100).toFixed(1)}%)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
