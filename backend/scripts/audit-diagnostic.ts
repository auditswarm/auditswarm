/**
 * Audit Diagnostic Script
 * Analyzes why audit results are all zeros by examining:
 * 1. Transaction data format (transfers JSON vs TransactionFlow records)
 * 2. What the bee expects vs what it actually gets
 * 3. Pre-period balances for accurate holdings
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find the user's wallet IDs
  const wallets = await prisma.wallet.findMany({
    select: { id: true, address: true, label: true },
  });
  console.log(`\n=== WALLETS (${wallets.length}) ===`);
  wallets.forEach(w => console.log(`  ${w.id} | ${w.address?.slice(0, 12)}... | ${w.label || 'no label'}`));

  const walletIds = wallets.map(w => w.id);

  // Count transactions by source and period
  const txCounts = await prisma.$queryRaw<{ source: string; year: number; month: number; count: bigint }[]>`
    SELECT source, EXTRACT(YEAR FROM timestamp) as year, EXTRACT(MONTH FROM timestamp) as month, COUNT(*) as count
    FROM transactions
    WHERE "walletId" IN (${walletIds.length > 0 ? prisma.$queryRaw`SELECT unnest(${walletIds}::text[])` : prisma.$queryRaw`SELECT null WHERE false`})
    GROUP BY source, year, month
    ORDER BY year, month
  `.catch(() => []);

  // Simpler query
  const txByType = await prisma.transaction.groupBy({
    by: ['type', 'source'],
    where: { walletId: { in: walletIds } },
    _count: true,
    orderBy: { _count: { type: 'desc' } },
  });

  console.log(`\n=== TRANSACTIONS BY TYPE & SOURCE ===`);
  txByType.forEach(t => console.log(`  ${t.type.padEnd(25)} | ${(t.source || 'ONCHAIN').padEnd(10)} | ${t._count}`));

  // Check Jan-Feb 2025 transactions specifically
  const startDate = new Date('2025-01-01');
  const endDate = new Date('2025-02-28T23:59:59');

  const janFeb = await prisma.transaction.findMany({
    where: {
      walletId: { in: walletIds },
      timestamp: { gte: startDate, lte: endDate },
    },
    orderBy: { timestamp: 'asc' },
    take: 20,
  });

  console.log(`\n=== JAN-FEB 2025 TRANSACTIONS (first 20) ===`);
  console.log(`Total count: ${await prisma.transaction.count({ where: { walletId: { in: walletIds }, timestamp: { gte: startDate, lte: endDate } } })}`);

  for (const tx of janFeb.slice(0, 5)) {
    console.log(`\n  TX: ${tx.id.slice(0, 8)}...`);
    console.log(`    type: ${tx.type} | source: ${tx.source} | timestamp: ${tx.timestamp.toISOString()}`);
    console.log(`    totalValueUsd: ${tx.totalValueUsd}`);
    console.log(`    signature: ${tx.signature?.slice(0, 20)}...`);

    // Check transfers JSON
    const transfers = tx.transfers;
    if (Array.isArray(transfers) && transfers.length > 0) {
      console.log(`    transfers JSON (${transfers.length} items):`);
      const sample = transfers[0] as any;
      console.log(`      First transfer keys: ${Object.keys(sample).join(', ')}`);
      console.log(`      Sample: ${JSON.stringify(sample).slice(0, 200)}`);
    } else {
      console.log(`    transfers JSON: ${transfers === null ? 'NULL' : Array.isArray(transfers) ? 'EMPTY ARRAY' : typeof transfers}`);
    }

    // Check TransactionFlow records for this tx
    const flows = await prisma.transactionFlow.findMany({
      where: { transactionId: tx.id },
    });
    if (flows.length > 0) {
      console.log(`    TransactionFlow records (${flows.length}):`);
      for (const f of flows) {
        console.log(`      ${f.direction} | mint: ${f.mint.slice(0, 12)}... | amount: ${f.amount} | valueUsd: ${f.valueUsd} | symbol: ${f.symbol || 'null'}`);
      }
    } else {
      console.log(`    TransactionFlow records: NONE`);
    }
  }

  // Check TransactionFlow totals
  const flowStats = await prisma.transactionFlow.groupBy({
    by: ['direction'],
    where: { walletId: { in: walletIds } },
    _count: true,
    _sum: { valueUsd: true },
  });

  console.log(`\n=== TRANSACTION FLOW STATS ===`);
  flowStats.forEach(f => {
    console.log(`  ${f.direction}: ${f._count} flows | total valueUsd: $${Number(f._sum.valueUsd || 0).toFixed(2)}`);
  });

  // Check flows for Jan-Feb 2025
  const flowsJanFeb = await prisma.transactionFlow.groupBy({
    by: ['direction'],
    where: {
      walletId: { in: walletIds },
      transaction: { timestamp: { gte: startDate, lte: endDate } },
    },
    _count: true,
    _sum: { valueUsd: true },
  });

  console.log(`\n=== JAN-FEB 2025 FLOW STATS ===`);
  flowsJanFeb.forEach(f => {
    console.log(`  ${f.direction}: ${f._count} flows | total valueUsd: $${Number(f._sum.valueUsd || 0).toFixed(2)}`);
  });

  // Check pre-period balances (everything before Jan 2025)
  console.log(`\n=== PRE-PERIOD BALANCES (before Jan 2025) ===`);
  const prePeriodFlows = await prisma.$queryRaw<{ mint: string; direction: string; totalAmount: any; totalValueUsd: any; count: bigint }[]>`
    SELECT
      f.mint,
      f.direction,
      SUM(f.amount) as "totalAmount",
      SUM(f."valueUsd") as "totalValueUsd",
      COUNT(*) as count
    FROM transaction_flows f
    JOIN transactions t ON f."transactionId" = t.id
    WHERE f."walletId" = ANY(${walletIds})
      AND t.timestamp < '2025-01-01'
    GROUP BY f.mint, f.direction
    ORDER BY SUM(f."valueUsd") DESC NULLS LAST
    LIMIT 20
  `;

  for (const row of prePeriodFlows) {
    console.log(`  ${row.mint.slice(0, 12)}... | ${row.direction} | amount: ${Number(row.totalAmount).toFixed(4)} | valueUsd: $${Number(row.totalValueUsd || 0).toFixed(2)} | ${row.count} flows`);
  }

  // Check what the bee would see — transfers JSON format analysis
  console.log(`\n=== TRANSFERS JSON FORMAT ANALYSIS ===`);
  const sampleTx = await prisma.transaction.findFirst({
    where: {
      walletId: { in: walletIds },
      type: { in: ['SWAP', 'SELL', 'TRANSFER', 'BUY'] },
      transfers: { not: null },
    },
    orderBy: { timestamp: 'desc' },
  });

  if (sampleTx && sampleTx.transfers) {
    const transfersArr = sampleTx.transfers as any[];
    console.log(`  Sample tx type: ${sampleTx.type}`);
    console.log(`  transfers is array: ${Array.isArray(transfersArr)}`);
    console.log(`  transfers count: ${transfersArr.length}`);
    if (transfersArr.length > 0) {
      console.log(`  First transfer (full):`);
      console.log(`    ${JSON.stringify(transfersArr[0], null, 2).split('\n').join('\n    ')}`);
      console.log(`\n  BEE EXPECTS: { mint, direction ('IN'|'OUT'), amount, valueUsd, symbol, isFee, decimals }`);
      const first = transfersArr[0];
      console.log(`  HAS 'direction'?: ${first.direction !== undefined}`);
      console.log(`  HAS 'mint'?: ${first.mint !== undefined}`);
      console.log(`  HAS 'amount'?: ${first.amount !== undefined}`);
      console.log(`  HAS 'valueUsd'?: ${first.valueUsd !== undefined}`);
      console.log(`  HAS 'isFee'?: ${first.isFee !== undefined}`);
    }
  } else {
    console.log(`  No sample transaction with transfers found`);
  }

  // Check exchange transactions too
  const exchangeTx = await prisma.transaction.findFirst({
    where: {
      source: 'EXCHANGE',
      transfers: { not: null },
    },
    orderBy: { timestamp: 'desc' },
  });

  if (exchangeTx && exchangeTx.transfers) {
    const transfersArr = exchangeTx.transfers as any[];
    console.log(`\n  Exchange tx type: ${exchangeTx.type}`);
    console.log(`  transfers count: ${transfersArr.length}`);
    if (transfersArr.length > 0) {
      console.log(`  First exchange transfer (full):`);
      console.log(`    ${JSON.stringify(transfersArr[0], null, 2).split('\n').join('\n    ')}`);
    }
  }

  // Summary: What's the root cause?
  console.log(`\n\n========================================`);
  console.log(`DIAGNOSIS SUMMARY`);
  console.log(`========================================`);

  const totalTx = await prisma.transaction.count({ where: { walletId: { in: walletIds } } });
  const totalFlows = await prisma.transactionFlow.count({ where: { walletId: { in: walletIds } } });
  const txWithTransfers = await prisma.transaction.count({
    where: {
      walletId: { in: walletIds },
      transfers: { not: null },
    },
  });

  console.log(`  Total transactions: ${totalTx}`);
  console.log(`  Txs with transfers JSON: ${txWithTransfers}`);
  console.log(`  Total TransactionFlow records: ${totalFlows}`);
  console.log(`  `);
  console.log(`  If TransactionFlow has data but transfers JSON doesn't match bee format,`);
  console.log(`  the fix is to load flows from TransactionFlow table instead of transfers JSON.`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
