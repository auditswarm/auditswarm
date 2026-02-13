import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find all transactions with fiat IN flows in 2025
  const fiatFlows = await prisma.transactionFlow.findMany({
    where: {
      direction: 'IN',
      OR: [
        { mint: { startsWith: 'fiat:' } },
        { mint: { startsWith: 'exchange:' } },
      ],
    },
    select: {
      transactionId: true,
      mint: true,
      symbol: true,
      valueUsd: true,
      amount: true,
    },
    take: 100,
  });

  console.log(`Found ${fiatFlows.length} fiat IN flows`);

  // Get unique mints
  const mints = new Set(fiatFlows.map(f => f.mint));
  console.log('\nFiat mint types found:', [...mints]);

  // Group by mint
  const byMint: Record<string, { count: number; totalUsd: number }> = {};
  for (const f of fiatFlows) {
    const entry = byMint[f.mint] || { count: 0, totalUsd: 0 };
    entry.count++;
    entry.totalUsd += Number(f.valueUsd || 0);
    byMint[f.mint] = entry;
  }

  console.log('\nFiat IN flows by mint:');
  for (const [mint, data] of Object.entries(byMint)) {
    console.log(`  ${mint}: ${data.count} flows, $${data.totalUsd.toFixed(2)} USD`);
  }

  // Get parent transactions for these flows
  const txIds = [...new Set(fiatFlows.map(f => f.transactionId))];
  const txs = await prisma.transaction.findMany({
    where: { id: { in: txIds } },
    select: { id: true, type: true, timestamp: true, totalValueUsd: true },
  });

  console.log('\nParent transaction types:');
  const byType: Record<string, number> = {};
  for (const tx of txs) {
    byType[tx.type] = (byType[tx.type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(byType)) {
    console.log(`  ${type}: ${count}`);
  }

  // Also check: what about EXCHANGE_FIAT_SELL type?
  const fiatSells = await prisma.transaction.count({
    where: { type: 'EXCHANGE_FIAT_SELL' },
  });
  console.log(`\nEXCHANGE_FIAT_SELL transactions: ${fiatSells}`);

  // Check SELL type
  const sells = await prisma.transaction.count({
    where: { type: 'SELL' },
  });
  console.log(`SELL transactions: ${sells}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
