import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const disposalTypes = [
    'SELL', 'SWAP', 'TRANSFER_OUT',
    'EXCHANGE_TRADE', 'EXCHANGE_C2C_TRADE', 'EXCHANGE_FIAT_SELL',
    'EXCHANGE_DUST_CONVERT', 'EXCHANGE_CONVERT', 'MARGIN_LIQUIDATION',
  ];

  const janStart = new Date(2025, 0, 1);
  const janEnd = new Date(2025, 1, 0, 23, 59, 59);

  const txs = await prisma.transaction.findMany({
    where: {
      type: { in: disposalTypes },
      timestamp: { gte: janStart, lte: janEnd },
    },
    select: { id: true, type: true, totalValueUsd: true, signature: true },
  });

  // Group by type
  const byType: Record<string, { count: number; totalUsd: number }> = {};
  for (const tx of txs) {
    const entry = byType[tx.type] || { count: 0, totalUsd: 0 };
    entry.count++;
    entry.totalUsd += Number(tx.totalValueUsd || 0);
    byType[tx.type] = entry;
  }

  console.log('January 2025 disposals by type:');
  for (const [type, data] of Object.entries(byType).sort((a, b) => b[1].totalUsd - a[1].totalUsd)) {
    console.log(`  ${type}: ${data.count} txs, $${data.totalUsd.toFixed(2)} USD`);
  }
  console.log(`  TOTAL: ${txs.length} txs`);

  // Get OUT flows (what actually counts as sales volume)
  const txIds = txs.map(t => t.id);
  const flows = await prisma.transactionFlow.findMany({
    where: {
      transactionId: { in: txIds },
      direction: 'OUT',
      isFee: false,
      NOT: [
        { mint: { startsWith: 'fiat:' } },
        { mint: { startsWith: 'exchange:' } },
        { mint: 'native' },
      ],
    },
    select: { transactionId: true, mint: true, symbol: true, valueUsd: true, amount: true },
  });

  // Group flow USD by tx type
  const txTypeMap = new Map(txs.map(t => [t.id, t.type]));
  const flowByType: Record<string, number> = {};
  for (const f of flows) {
    const type = txTypeMap.get(f.transactionId) || 'UNKNOWN';
    flowByType[type] = (flowByType[type] || 0) + Number(f.valueUsd || 0);
  }

  console.log('\nJanuary OUT flow values by disposal type (= sales volume input):');
  for (const [type, usd] of Object.entries(flowByType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: $${usd.toFixed(2)} USD (~R$${(usd * 5.8).toFixed(0)})`);
  }
  const totalFlowUsd = Object.values(flowByType).reduce((s, v) => s + v, 0);
  console.log(`  TOTAL: $${totalFlowUsd.toFixed(2)} USD (~R$${(totalFlowUsd * 5.8).toFixed(0)})`);

  // Top 10 biggest individual flows
  const sortedFlows = flows.sort((a, b) => Number(b.valueUsd || 0) - Number(a.valueUsd || 0));
  console.log('\nTop 10 biggest OUT flows in January:');
  for (const f of sortedFlows.slice(0, 10)) {
    const type = txTypeMap.get(f.transactionId) || '?';
    console.log(`  ${f.symbol || f.mint.slice(0, 8)}: $${Number(f.valueUsd).toFixed(2)} (${type}) amount=${Number(f.amount).toFixed(4)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
