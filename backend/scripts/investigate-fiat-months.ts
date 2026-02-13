import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const months = ['Jan', 'Feb', 'Mar'];
  const start = new Date(2025, 0, 1);  // Jan 1
  const end = new Date(2025, 3, 0, 23, 59, 59);  // Mar 31

  console.log('==========================================================');
  console.log('SCRIPT 1: Investigate Fiat Months (Jan-Mar 2025)');
  console.log('==========================================================\n');

  // ---- PART A: ALL exchange transactions by month AND type ----
  console.log('--- PART A: ALL exchange transactions by month and type ---\n');

  const allExTxs = await prisma.transaction.findMany({
    where: {
      source: 'EXCHANGE',
      timestamp: { gte: start, lte: end },
    },
    select: { id: true, type: true, timestamp: true, totalValueUsd: true },
    orderBy: { timestamp: 'asc' },
  });

  console.log(`Total exchange transactions in Jan-Mar 2025: ${allExTxs.length}\n`);

  // Group by month + type
  const byMonthType: Record<string, Record<string, { count: number; usd: number }>> = {};
  for (const tx of allExTxs) {
    const month = tx.timestamp.getMonth(); // 0=Jan, 1=Feb, 2=Mar
    if (month > 2) continue;
    const m = months[month];
    if (!byMonthType[m]) byMonthType[m] = {};
    const entry = byMonthType[m][tx.type] || { count: 0, usd: 0 };
    entry.count++;
    entry.usd += Number(tx.totalValueUsd || 0);
    byMonthType[m][tx.type] = entry;
  }

  for (const m of months) {
    const types = byMonthType[m] || {};
    const totalCount = Object.values(types).reduce((s, t) => s + t.count, 0);
    const totalUsd = Object.values(types).reduce((s, t) => s + t.usd, 0);
    console.log(`${m} 2025: ${totalCount} transactions, $${totalUsd.toFixed(2)} total USD`);
    for (const [type, data] of Object.entries(types).sort((a, b) => b[1].count - a[1].count)) {
      console.log(`  ${type.padEnd(30)} ${String(data.count).padStart(4)} txs  $${data.usd.toFixed(2).padStart(12)}`);
    }
    console.log('');
  }

  // ---- PART B: Check TransactionFlow records for fiat/exchange mints ----
  console.log('\n--- PART B: Fiat/exchange mints in TransactionFlow records ---\n');

  const txIds = allExTxs.map(t => t.id);

  // Fetch ALL flows for these transactions
  const allFlows = await prisma.transactionFlow.findMany({
    where: { transactionId: { in: txIds } },
    select: {
      transactionId: true,
      mint: true,
      symbol: true,
      direction: true,
      valueUsd: true,
      amount: true,
      isFee: true,
    },
  });

  console.log(`Total flows for Jan-Mar exchange txs: ${allFlows.length}`);

  // Build a map of txId -> transaction for month lookup
  const txMap = new Map(allExTxs.map(t => [t.id, t]));

  // Find flows with fiat/exchange mints
  const fiatFlows = allFlows.filter(f =>
    f.mint.startsWith('fiat:') || f.mint.startsWith('exchange:')
  );

  console.log(`Flows with fiat:/exchange: mints: ${fiatFlows.length}\n`);

  // Group fiat flows by month
  const fiatByMonth: Record<string, { count: number; mints: Set<string>; totalUsd: number; directions: Record<string, number> }> = {};
  for (const f of fiatFlows) {
    const tx = txMap.get(f.transactionId);
    if (!tx) continue;
    const month = tx.timestamp.getMonth();
    if (month > 2) continue;
    const m = months[month];
    if (!fiatByMonth[m]) fiatByMonth[m] = { count: 0, mints: new Set(), totalUsd: 0, directions: {} };
    fiatByMonth[m].count++;
    fiatByMonth[m].mints.add(f.mint);
    fiatByMonth[m].totalUsd += Number(f.valueUsd || 0);
    fiatByMonth[m].directions[f.direction] = (fiatByMonth[m].directions[f.direction] || 0) + 1;
  }

  for (const m of months) {
    const data = fiatByMonth[m];
    if (!data) {
      console.log(`${m}: NO fiat/exchange flows found!`);
      continue;
    }
    console.log(`${m}: ${data.count} fiat flows, $${data.totalUsd.toFixed(2)} USD`);
    console.log(`  Mints: ${[...data.mints].join(', ')}`);
    console.log(`  Directions: ${JSON.stringify(data.directions)}`);
  }

  // ---- PART C: All unique fiat/exchange mints across all flows ----
  console.log('\n--- PART C: All unique fiat/exchange mint values found ---\n');

  const allFiatMints = new Set<string>();
  const allExchangeMints = new Set<string>();
  for (const f of allFlows) {
    if (f.mint.startsWith('fiat:')) allFiatMints.add(f.mint);
    if (f.mint.startsWith('exchange:')) allExchangeMints.add(f.mint);
  }
  console.log('fiat: mints:', [...allFiatMints].sort());
  console.log('exchange: mints:', [...allExchangeMints].sort());

  // ---- PART D: For transactions WITHOUT fiat flows, what are their flows? ----
  console.log('\n--- PART D: Exchange txs that involve BRL (rawData) but have NO fiat flows ---\n');

  const txsWithFiatFlows = new Set(fiatFlows.map(f => f.transactionId));

  // Find BRL transactions without fiat flows
  let brlNoFiat = 0;
  const brlNoFiatByMonth: Record<string, { count: number; types: Record<string, number>; totalUsd: number }> = {};

  for (const tx of allExTxs) {
    const rawStr = JSON.stringify(tx.rawData || {});
    const hasBRL = rawStr.includes('BRL') || rawStr.includes('brl');
    if (!hasBRL) continue;

    const hasFiatFlow = txsWithFiatFlows.has(tx.id);
    if (!hasFiatFlow) {
      brlNoFiat++;
      const month = tx.timestamp.getMonth();
      if (month > 2) continue;
      const m = months[month];
      if (!brlNoFiatByMonth[m]) brlNoFiatByMonth[m] = { count: 0, types: {}, totalUsd: 0 };
      brlNoFiatByMonth[m].count++;
      brlNoFiatByMonth[m].types[tx.type] = (brlNoFiatByMonth[m].types[tx.type] || 0) + 1;
      brlNoFiatByMonth[m].totalUsd += Number(tx.totalValueUsd || 0);
    }
  }

  console.log(`BRL transactions WITHOUT fiat flows: ${brlNoFiat}`);
  for (const m of months) {
    const data = brlNoFiatByMonth[m];
    if (!data) {
      console.log(`  ${m}: NONE`);
      continue;
    }
    console.log(`  ${m}: ${data.count} txs, $${data.totalUsd.toFixed(2)}`);
    for (const [type, count] of Object.entries(data.types)) {
      console.log(`    ${type}: ${count}`);
    }
  }

  // ---- PART E: Sample BRL transactions and their actual flow mints ----
  console.log('\n--- PART E: Sample BRL transactions and their actual flow mints ---\n');

  let sampleCount = 0;
  for (const tx of allExTxs) {
    if (sampleCount >= 20) break;
    const rawStr = JSON.stringify(tx.rawData || {});
    if (!rawStr.includes('BRL')) continue;

    const txFlows = allFlows.filter(f => f.transactionId === tx.id);
    const month = months[tx.timestamp.getMonth()];
    const raw = tx.rawData as any;

    console.log(`[${month}] ${tx.timestamp.toISOString().slice(0, 10)} ${tx.type} $${Number(tx.totalValueUsd || 0).toFixed(2)}`);
    console.log(`  rawData: fromAsset=${raw?.fromAsset || '-'} toAsset=${raw?.toAsset || '-'} symbol=${raw?.symbol || '-'}`);

    for (const f of txFlows) {
      console.log(`  flow: ${f.direction} mint=${f.mint} sym=${f.symbol || '-'} amt=${Number(f.amount).toFixed(6)} val=$${Number(f.valueUsd || 0).toFixed(2)} fee=${f.isFee}`);
    }
    console.log('');
    sampleCount++;
  }

  // ---- PART F: Compare fiat flow presence with tx type ----
  console.log('\n--- PART F: Which tx types produce fiat flows? ---\n');

  const typeHasFiat: Record<string, { withFiat: number; withoutFiat: number }> = {};
  for (const tx of allExTxs) {
    const rawStr = JSON.stringify(tx.rawData || {});
    if (!rawStr.includes('BRL')) continue;

    const hasFiatFlow = txsWithFiatFlows.has(tx.id);
    if (!typeHasFiat[tx.type]) typeHasFiat[tx.type] = { withFiat: 0, withoutFiat: 0 };
    if (hasFiatFlow) {
      typeHasFiat[tx.type].withFiat++;
    } else {
      typeHasFiat[tx.type].withoutFiat++;
    }
  }

  console.log('BRL-related tx types and fiat flow presence:');
  for (const [type, data] of Object.entries(typeHasFiat)) {
    console.log(`  ${type}: ${data.withFiat} WITH fiat flow, ${data.withoutFiat} WITHOUT fiat flow`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
