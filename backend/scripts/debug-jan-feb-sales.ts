import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Check ALL exchange transactions in Jan-Mar 2025
  const start = new Date(2025, 0, 1);
  const end = new Date(2025, 2, 31, 23, 59, 59);

  const txs = await prisma.transaction.findMany({
    where: {
      timestamp: { gte: start, lte: end },
      source: 'EXCHANGE',
    },
    select: { id: true, type: true, timestamp: true, totalValueUsd: true, exchangeName: true },
    orderBy: { timestamp: 'asc' },
  });

  console.log(`Exchange transactions Jan-Mar 2025: ${txs.length}`);

  // Group by type and month
  const byTypeMonth: Record<string, Record<number, { count: number; usd: number }>> = {};
  for (const tx of txs) {
    const month = tx.timestamp.getMonth();
    const type = tx.type;
    if (!byTypeMonth[type]) byTypeMonth[type] = {};
    const entry = byTypeMonth[type][month] || { count: 0, usd: 0 };
    entry.count++;
    entry.usd += Number(tx.totalValueUsd || 0);
    byTypeMonth[type][month] = entry;
  }

  const months = ['Jan', 'Feb', 'Mar'];
  console.log('\nBy type and month:');
  for (const [type, monthData] of Object.entries(byTypeMonth).sort()) {
    for (const [m, data] of Object.entries(monthData)) {
      console.log(`  ${months[Number(m)]} ${type}: ${data.count} txs, $${data.usd.toFixed(2)}`);
    }
  }

  // Now check flows for these transactions - look at ALL flow mints
  const txIds = txs.map(t => t.id);
  const flows = await prisma.transactionFlow.findMany({
    where: { transactionId: { in: txIds } },
    select: { transactionId: true, mint: true, symbol: true, direction: true, valueUsd: true, amount: true },
  });

  // Find unique mints in IN direction
  const inMints = new Set<string>();
  const outMints = new Set<string>();
  for (const f of flows) {
    if (f.direction === 'IN') inMints.add(`${f.mint} (${f.symbol || '?'})`);
    if (f.direction === 'OUT') outMints.add(`${f.mint} (${f.symbol || '?'})`);
  }
  console.log('\nAll IN mints in Jan-Mar exchange txs:');
  for (const m of [...inMints].sort()) console.log(`  ${m}`);

  console.log('\nAll OUT mints in Jan-Mar exchange txs:');
  for (const m of [...outMints].sort()) console.log(`  ${m}`);

  // Check specifically for BRL-related flows
  console.log('\n--- BRL/fiat related flows ---');
  const brlFlows = flows.filter(f =>
    f.mint.includes('BRL') || f.mint.includes('brl') ||
    f.mint.startsWith('fiat:') || f.mint.startsWith('exchange:') ||
    (f.symbol && (f.symbol.includes('BRL') || f.symbol.includes('brl')))
  );
  for (const f of brlFlows) {
    const tx = txs.find(t => t.id === f.transactionId);
    console.log(`  ${tx?.timestamp.toISOString().slice(0,10)} ${f.direction} mint=${f.mint} sym=${f.symbol} val=$${Number(f.valueUsd).toFixed(2)} amt=${Number(f.amount).toFixed(2)} type=${tx?.type}`);
  }

  // Check for EXCHANGE_FIAT_SELL or SELL types specifically
  console.log('\n--- Looking for fiat sell indicators ---');
  const fiatSellTypes = ['EXCHANGE_FIAT_SELL', 'SELL', 'EXCHANGE_FIAT_BUY'];
  const fiatSells = await prisma.transaction.findMany({
    where: {
      type: { in: fiatSellTypes },
      timestamp: { gte: start, lte: end },
    },
    select: { id: true, type: true, timestamp: true, totalValueUsd: true },
  });
  console.log(`EXCHANGE_FIAT_SELL/SELL/FIAT_BUY in Jan-Mar: ${fiatSells.length}`);
  for (const tx of fiatSells) {
    console.log(`  ${tx.timestamp.toISOString().slice(0,10)} ${tx.type} $${Number(tx.totalValueUsd).toFixed(2)}`);
  }

  // Check raw data of EXCHANGE_TRADE transactions in January for BRL pairs
  console.log('\n--- EXCHANGE_TRADE raw data sample (Jan) ---');
  const janTrades = await prisma.transaction.findMany({
    where: {
      type: 'EXCHANGE_TRADE',
      timestamp: { gte: new Date(2025, 0, 1), lte: new Date(2025, 0, 31, 23, 59, 59) },
      source: 'EXCHANGE',
    },
    select: { id: true, timestamp: true, totalValueUsd: true, rawData: true },
    take: 5,
  });
  for (const tx of janTrades) {
    const raw = tx.rawData as any;
    console.log(`  ${tx.timestamp.toISOString().slice(0,10)} $${Number(tx.totalValueUsd).toFixed(2)} pair=${raw?.symbol || raw?.pair || '?'} side=${raw?.side || '?'}`);
  }

  // Check EXCHANGE_CONVERT in January
  console.log('\n--- EXCHANGE_CONVERT raw data sample (Jan) ---');
  const janConverts = await prisma.transaction.findMany({
    where: {
      type: 'EXCHANGE_CONVERT',
      timestamp: { gte: new Date(2025, 0, 1), lte: new Date(2025, 0, 31, 23, 59, 59) },
      source: 'EXCHANGE',
    },
    select: { id: true, timestamp: true, totalValueUsd: true, rawData: true },
    take: 10,
  });
  console.log(`EXCHANGE_CONVERT in Jan: ${janConverts.length}`);
  for (const tx of janConverts) {
    const raw = tx.rawData as any;
    console.log(`  ${tx.timestamp.toISOString().slice(0,10)} $${Number(tx.totalValueUsd).toFixed(2)} from=${raw?.fromAsset || '?'} to=${raw?.toAsset || '?'}`);
  }

  // Check ALL exchange types with BRL in raw data
  console.log('\n--- All exchange txs with BRL in rawData (Jan-Mar) ---');
  const allExTxs = await prisma.transaction.findMany({
    where: {
      source: 'EXCHANGE',
      timestamp: { gte: start, lte: end },
    },
    select: { id: true, type: true, timestamp: true, totalValueUsd: true, rawData: true },
  });

  let brlCount = 0;
  for (const tx of allExTxs) {
    const rawStr = JSON.stringify(tx.rawData || {});
    if (rawStr.includes('BRL') || rawStr.includes('brl')) {
      brlCount++;
      if (brlCount <= 15) {
        const raw = tx.rawData as any;
        console.log(`  ${tx.timestamp.toISOString().slice(0,10)} ${tx.type} $${Number(tx.totalValueUsd).toFixed(2)} pair=${raw?.symbol || ''} from=${raw?.fromAsset || ''} to=${raw?.toAsset || ''}`);
      }
    }
  }
  console.log(`Total exchange txs with BRL in rawData: ${brlCount}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
