import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Find all transactions in 2025 that have fiat on the IN side
  const allFlows = await prisma.transactionFlow.findMany({
    where: {
      direction: 'IN',
      OR: [
        { mint: { startsWith: 'fiat:' } },
        { mint: { startsWith: 'exchange:' } },
      ],
    },
    select: { transactionId: true, mint: true, valueUsd: true },
  });

  const fiatTxIds = [...new Set(allFlows.map(f => f.transactionId))];
  console.log(`Transactions with fiat IN: ${fiatTxIds.length}`);

  // Get those transactions
  const txs = await prisma.transaction.findMany({
    where: { id: { in: fiatTxIds } },
    select: { id: true, type: true, timestamp: true, totalValueUsd: true },
  });

  // Get OUT flows for these transactions (crypto side = alienation value)
  const outFlows = await prisma.transactionFlow.findMany({
    where: {
      transactionId: { in: fiatTxIds },
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

  // Group by month
  const txMap = new Map(txs.map(t => [t.id, t]));
  const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const byMonth: Record<number, { count: number; usd: number; txTypes: string[] }> = {};

  for (const f of outFlows) {
    const tx = txMap.get(f.transactionId);
    if (!tx) continue;
    const month = tx.timestamp.getMonth();
    const entry = byMonth[month] || { count: 0, usd: 0, txTypes: [] };
    entry.usd += Number(f.valueUsd || 0);
    if (!entry.txTypes.includes(tx.type)) entry.txTypes.push(tx.type);
    byMonth[month] = entry;
  }

  // Count transactions per month
  for (const tx of txs) {
    const month = tx.timestamp.getMonth();
    const entry = byMonth[month] || { count: 0, usd: 0, txTypes: [] };
    entry.count++;
    byMonth[month] = entry;
  }

  console.log('\nMonthly fiat sales (what would show in chart):');
  console.log('Month | Txs | USD Value | ~BRL (5.8x) | vs R$35K');
  for (let m = 0; m < 12; m++) {
    const data = byMonth[m];
    if (!data) {
      console.log(`${monthNames[m]}   |   0 |     $0.00 |       R$0   | EXEMPT (no sales)`);
      continue;
    }
    const brl = data.usd * 5.8;
    const status = brl <= 35000 ? 'EXEMPT' : 'TAXABLE';
    console.log(`${monthNames[m]}   | ${String(data.count).padStart(3)} | $${data.usd.toFixed(2).padStart(10)} | R$${brl.toFixed(0).padStart(8)} | ${status} [${data.txTypes.join(', ')}]`);
  }

  // Total
  const totalUsd = Object.values(byMonth).reduce((s, d) => s + d.usd, 0);
  console.log(`\nTotal fiat sales: $${totalUsd.toFixed(2)} USD (~R$${(totalUsd * 5.8).toFixed(0)})`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
