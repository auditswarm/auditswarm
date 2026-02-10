/**
 * Check reconciliation status and snapshot capabilities.
 * Usage: cd backend && NODE_PATH=libs/database/node_modules npx tsx scripts/check-readiness.ts
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  try {
    // 1. Reconciliation status
    const linked = await prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(*)::int as count FROM transactions WHERE "linkedTransactionId" IS NOT NULL
    `;
    console.log('=== RECONCILIATION STATUS ===');
    console.log('Linked transactions:', linked[0].count);

    // 2. Exchange deposits/withdrawals with txId
    const depositsWithTxId = await prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(*)::int as count
      FROM transactions
      WHERE "type" = 'EXCHANGE_DEPOSIT' AND "rawData"::text LIKE '%txId%'
    `;
    const withdrawalsWithTxId = await prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(*)::int as count
      FROM transactions
      WHERE "type" = 'EXCHANGE_WITHDRAWAL' AND "rawData"::text LIKE '%txId%'
    `;
    console.log('Exchange deposits with txId:', depositsWithTxId[0].count);
    console.log('Exchange withdrawals with txId:', withdrawalsWithTxId[0].count);

    // 3. Sample SOL deposits with txId
    const sampleDeposits = await prisma.$queryRaw<any[]>`
      SELECT "externalId", "timestamp",
             "rawData"->>'txId' as tx_id,
             "rawData"->>'network' as network,
             "rawData"->>'coin' as coin,
             "rawData"->>'amount' as amount
      FROM transactions
      WHERE "type" = 'EXCHANGE_DEPOSIT'
        AND "rawData"::text LIKE '%txId%'
        AND "rawData"->>'network' = 'SOL'
      LIMIT 5
    `;
    console.log('\nSample SOL deposits with txId:');
    for (const d of sampleDeposits) {
      const date = new Date(d.timestamp).toISOString().split('T')[0];
      console.log(`  ${d.coin} ${d.amount} on ${date} txId: ${d.tx_id || 'null'}`);
    }

    // 4. Check if those txIds exist on-chain
    if (sampleDeposits.length > 0) {
      for (const d of sampleDeposits) {
        if (!d.tx_id) continue;
        const match = await prisma.$queryRaw<any[]>`
          SELECT "signature", "type", "timestamp"
          FROM transactions
          WHERE "signature" = ${d.tx_id}
        `;
        console.log(`  → On-chain match: ${match.length > 0 ? 'YES (' + match[0].type + ')' : 'NO'}`);
      }
    }

    // 5. Timeline overlap
    const exchangeDates = await prisma.$queryRaw<any[]>`
      SELECT MIN("timestamp") as earliest, MAX("timestamp") as latest
      FROM transactions WHERE "source" = 'EXCHANGE'
    `;
    const onchainDates = await prisma.$queryRaw<any[]>`
      SELECT MIN("timestamp") as earliest, MAX("timestamp") as latest
      FROM transactions WHERE "source" = 'ONCHAIN'
    `;
    console.log('\n=== TIMELINE OVERLAP ===');
    console.log('Exchange:', new Date(exchangeDates[0].earliest).toISOString().split('T')[0], '→', new Date(exchangeDates[0].latest).toISOString().split('T')[0]);
    console.log('On-chain:', new Date(onchainDates[0].earliest).toISOString().split('T')[0], '→', new Date(onchainDates[0].latest).toISOString().split('T')[0]);

    // Overlap detail
    const overlapTxs = await prisma.$queryRaw<any[]>`
      SELECT "source", COUNT(*)::int as count
      FROM transactions
      WHERE "timestamp" >= '2026-02-01' AND "timestamp" < '2026-02-10'
      GROUP BY "source"
    `;
    console.log('\nFeb 2026 (overlap period):');
    for (const r of overlapTxs) {
      console.log(`  ${r.source}: ${r.count} txs`);
    }

    // 7. TRANSFER_OUT → could match exchange deposits?
    const transferOuts = await prisma.$queryRaw<any[]>`
      SELECT t."signature", t."timestamp", t."totalValueUsd",
             t."classificationStatus", t."category", t."linkedTransactionId"
      FROM transactions t
      WHERE t."type" = 'TRANSFER_OUT' AND t."source" = 'ONCHAIN'
      ORDER BY t."timestamp" DESC LIMIT 10
    `;
    console.log('\n=== RECENT ON-CHAIN TRANSFER_OUTs ===');
    for (const t of transferOuts) {
      const date = new Date(t.timestamp).toISOString().slice(0, 16);
      const sig = t.signature?.slice(0, 12) || 'null';
      const val = Number(t.totalValueUsd || 0).toFixed(2);
      const linked = t.linkedTransactionId || 'none';
      console.log(`  ${date} sig:${sig}... $${val} linked:${linked}`);
    }

    // 8. Portfolio snapshots
    const snapshots = await prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(*)::int as count FROM portfolio_snapshots
    `;
    console.log('\n=== PORTFOLIO SNAPSHOTS ===');
    console.log('Existing snapshots:', snapshots[0].count);

    // 9. Point-in-time reconstruction test
    const dec31 = await prisma.$queryRaw<any[]>`
      SELECT tf."mint",
        SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END) as total_in,
        SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END) as total_out,
        SUM(CASE WHEN tf."direction" = 'IN' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END) as value_in,
        SUM(CASE WHEN tf."direction" = 'OUT' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END) as value_out
      FROM transaction_flows tf
      JOIN transactions t ON t.id = tf."transactionId"
      WHERE t."timestamp" <= '2025-12-31 23:59:59'
        AND tf."isFee" = false
      GROUP BY tf."mint"
      HAVING SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END) -
             SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END) > 0.000001
      ORDER BY (SUM(CASE WHEN tf."direction" = 'IN' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END) -
                SUM(CASE WHEN tf."direction" = 'OUT' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)) DESC
    `;
    console.log('\n=== SNAPSHOT TEST: Holdings as of Dec 31, 2025 ===');
    for (const r of dec31) {
      const holding = Number(r.total_in) - Number(r.total_out);
      const valueNet = Number(r.value_in) - Number(r.value_out);
      const mint = r.mint.length > 20 ? r.mint.slice(0, 8) + '...' : r.mint;
      console.log(`  ${mint}: ${holding.toFixed(6)} (net value: $${valueNet.toFixed(2)})`);
    }

    // 10. Same for current
    const now = await prisma.$queryRaw<any[]>`
      SELECT tf."mint",
        SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END) as total_in,
        SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END) as total_out
      FROM transaction_flows tf
      JOIN transactions t ON t.id = tf."transactionId"
      WHERE tf."isFee" = false
      GROUP BY tf."mint"
      HAVING SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END) -
             SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END) > 0.000001
      ORDER BY SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END) -
               SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END) DESC
    `;
    console.log('\n=== SNAPSHOT TEST: Current holdings (all time) ===');
    for (const r of now) {
      const holding = Number(r.total_in) - Number(r.total_out);
      const mint = r.mint.length > 20 ? r.mint.slice(0, 8) + '...' : r.mint;
      console.log(`  ${mint}: ${holding.toFixed(6)}`);
    }

  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
