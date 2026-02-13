import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Check exchange tx count by month for ALL of 2025
  console.log('=== Exchange transactions by month (2025) ===');
  for (let m = 0; m < 12; m++) {
    const start = new Date(2025, m, 1);
    const end = new Date(2025, m + 1, 0, 23, 59, 59);
    const count = await prisma.transaction.count({
      where: { source: 'EXCHANGE', timestamp: { gte: start, lte: end } },
    });
    const usd = await prisma.transaction.aggregate({
      where: { source: 'EXCHANGE', timestamp: { gte: start, lte: end } },
      _sum: { totalValueUsd: true },
    });
    console.log(`  ${months[m]}: ${count} txs, $${Number(usd._sum.totalValueUsd || 0).toFixed(2)}`);
  }

  // Check on-chain tx count by month for 2025
  console.log('\n=== On-chain transactions by month (2025) ===');
  for (let m = 0; m < 12; m++) {
    const start = new Date(2025, m, 1);
    const end = new Date(2025, m + 1, 0, 23, 59, 59);
    const count = await prisma.transaction.count({
      where: { source: 'ONCHAIN', timestamp: { gte: start, lte: end } },
    });
    console.log(`  ${months[m]}: ${count} txs`);
  }

  // Check earliest and latest exchange transaction
  const earliest = await prisma.transaction.findFirst({
    where: { source: 'EXCHANGE' },
    orderBy: { timestamp: 'asc' },
    select: { timestamp: true, type: true },
  });
  const latest = await prisma.transaction.findFirst({
    where: { source: 'EXCHANGE' },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true, type: true },
  });
  console.log(`\nExchange data range: ${earliest?.timestamp.toISOString().slice(0,10)} to ${latest?.timestamp.toISOString().slice(0,10)}`);

  // Check the exchange sync status
  const conn = await prisma.exchangeConnection.findFirst({
    select: { id: true, exchangeName: true, lastSyncAt: true, status: true, syncCursors: true },
  });
  console.log(`\nExchange connection: ${conn?.exchangeName} status=${conn?.status} lastSync=${conn?.lastSyncAt?.toISOString()}`);
  if (conn?.syncCursors) {
    console.log('Sync cursors:', JSON.stringify(conn.syncCursors, null, 2));
  }

  // Check EXCHANGE_WITHDRAWAL in Jan-Feb specifically
  console.log('\n=== EXCHANGE_WITHDRAWAL details (Feb-Mar) ===');
  const withdrawals = await prisma.transaction.findMany({
    where: {
      type: 'EXCHANGE_WITHDRAWAL',
      timestamp: { gte: new Date(2025, 1, 1), lte: new Date(2025, 2, 31, 23, 59, 59) },
    },
    select: { id: true, timestamp: true, totalValueUsd: true, rawData: true },
    orderBy: { timestamp: 'asc' },
  });
  for (const tx of withdrawals) {
    const raw = tx.rawData as any;
    console.log(`  ${tx.timestamp.toISOString().slice(0,10)} $${Number(tx.totalValueUsd).toFixed(2)} asset=${raw?.coin || raw?.asset || '?'} network=${raw?.network || '?'} to=${(raw?.address || '?').slice(0, 12)}...`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
