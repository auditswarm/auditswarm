import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('==========================================================');
  console.log('SCRIPT 3: Investigate Convert Dates');
  console.log('==========================================================\n');

  // ---- PART A: ALL EXCHANGE_CONVERT transactions, full range ----
  console.log('--- PART A: ALL EXCHANGE_CONVERT transactions ever ---\n');

  const allConverts = await prisma.transaction.findMany({
    where: { type: 'EXCHANGE_CONVERT' },
    select: { id: true, timestamp: true, totalValueUsd: true, rawData: true, externalId: true },
    orderBy: { timestamp: 'asc' },
  });

  console.log(`Total EXCHANGE_CONVERT transactions: ${allConverts.length}\n`);

  for (const tx of allConverts) {
    const raw = tx.rawData as any;
    const hasBRL = JSON.stringify(raw || {}).includes('BRL');
    const brlFlag = hasBRL ? ' [BRL]' : '';
    console.log(`${tx.timestamp.toISOString().slice(0, 19)} $${Number(tx.totalValueUsd || 0).toFixed(2).padStart(12)} from=${(raw?.fromAsset || '?').padEnd(6)} to=${(raw?.toAsset || '?').padEnd(6)} fromAmt=${raw?.fromAmount || '?'} toAmt=${raw?.toAmount || '?'}${brlFlag}`);
    if (raw?.createTime) {
      const rawTs = new Date(raw.createTime);
      const diff = Math.abs(tx.timestamp.getTime() - rawTs.getTime());
      if (diff > 1000) {
        console.log(`  WARNING: DB timestamp differs from rawData.createTime by ${(diff / 1000).toFixed(0)}s`);
      }
    }
  }

  // ---- PART B: BRL-specific converts ----
  console.log('\n--- PART B: BRL-specific converts - monthly distribution ---\n');

  const brlConverts = allConverts.filter(tx => {
    const rawStr = JSON.stringify(tx.rawData || {});
    return rawStr.includes('BRL');
  });

  console.log(`BRL converts total: ${brlConverts.length}`);

  const months: Record<string, { count: number; totalUsd: number; details: string[] }> = {};
  for (const tx of brlConverts) {
    const raw = tx.rawData as any;
    const key = tx.timestamp.toISOString().slice(0, 7); // YYYY-MM
    if (!months[key]) months[key] = { count: 0, totalUsd: 0, details: [] };
    months[key].count++;
    months[key].totalUsd += Number(tx.totalValueUsd || 0);
    months[key].details.push(
      `${tx.timestamp.toISOString().slice(0, 19)} ${raw?.fromAsset}->${raw?.toAsset} $${Number(tx.totalValueUsd || 0).toFixed(2)}`
    );
  }

  for (const [month, data] of Object.entries(months).sort()) {
    console.log(`\n${month}: ${data.count} BRL converts, $${data.totalUsd.toFixed(2)} USD`);
    for (const d of data.details) {
      console.log(`  ${d}`);
    }
  }

  // ---- PART C: Check ENTIRE sync range - when does data begin? ----
  console.log('\n\n--- PART C: Exchange data date range analysis ---\n');

  const earliest = await prisma.transaction.findFirst({
    where: { source: 'EXCHANGE' },
    orderBy: { timestamp: 'asc' },
    select: { timestamp: true, type: true, rawData: true },
  });

  const latest = await prisma.transaction.findFirst({
    where: { source: 'EXCHANGE' },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true, type: true },
  });

  console.log(`Earliest exchange transaction: ${earliest?.timestamp.toISOString()} (${earliest?.type})`);
  console.log(`Latest exchange transaction:   ${latest?.timestamp.toISOString()} (${latest?.type})`);

  // Check the sync cursor
  const conn = await prisma.exchangeConnection.findFirst({
    select: { syncCursor: true, createdAt: true },
  });

  const cursor = conn?.syncCursor as any;
  if (cursor) {
    // Check convertEndTime (this was set to "earliest" at the end of the fetch)
    const convertEndTime = cursor?.phase2?.convertEndTime;
    const dustWindowEnd = cursor?.phase2?.dustWindowEnd;
    const depositsWindowEnd = cursor?.phase1?.depositsWindowEnd;
    const withdrawalsWindowEnd = cursor?.phase1?.withdrawalsWindowEnd;

    console.log(`\nSync cursor key timestamps:`);
    console.log(`  convertEndTime:      ${convertEndTime} -> ${new Date(convertEndTime).toISOString()}`);
    console.log(`  dustWindowEnd:       ${dustWindowEnd} -> ${new Date(dustWindowEnd).toISOString()}`);
    console.log(`  depositsWindowEnd:   ${depositsWindowEnd} -> ${new Date(depositsWindowEnd).toISOString()}`);
    console.log(`  withdrawalsWindowEnd: ${withdrawalsWindowEnd} -> ${new Date(withdrawalsWindowEnd).toISOString()}`);
    console.log(`  Connection created:  ${conn?.createdAt?.toISOString()}`);
  }

  // ---- PART D: KEY QUESTION - What was the Binance API time range? ----
  console.log('\n--- PART D: Binance API one-year lookback analysis ---\n');

  // The Binance connector uses ONE_YEAR_MS limit: now - 365 days
  // If the sync was done recently, it would start from ~Feb 2025
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  // Check when the sync was done (from the connection's lastSyncAt)
  const connFull = await prisma.exchangeConnection.findFirst({
    select: { lastSyncAt: true, createdAt: true },
  });

  if (connFull?.lastSyncAt) {
    const syncDate = connFull.lastSyncAt;
    const oneYearBack = new Date(syncDate.getTime() - ONE_YEAR_MS);
    console.log(`Last sync date:        ${syncDate.toISOString()}`);
    console.log(`One year before sync:  ${oneYearBack.toISOString()}`);
    console.log(`\n*** If Binance API has 1-year history limit, this means:`);
    console.log(`    - Data starts from: ${oneYearBack.toISOString().slice(0, 10)}`);
    console.log(`    - January 2025 would be: ${oneYearBack < new Date(2025, 0, 1) ? 'WITHIN range' : 'OUTSIDE range (too old!)'}`);
  }

  // ---- PART E: Check if there's a "since" option stored or look at actual data gaps ----
  console.log('\n--- PART E: Data gap analysis by day (Jan-Mar 2025) ---\n');

  const janStart = new Date(2025, 0, 1);
  const marEnd = new Date(2025, 3, 0, 23, 59, 59);

  const dayTxs = await prisma.transaction.findMany({
    where: {
      source: 'EXCHANGE',
      timestamp: { gte: janStart, lte: marEnd },
    },
    select: { timestamp: true, type: true },
    orderBy: { timestamp: 'asc' },
  });

  // Create daily buckets
  const dayBuckets: Record<string, { count: number; types: Set<string> }> = {};
  for (const tx of dayTxs) {
    const day = tx.timestamp.toISOString().slice(0, 10);
    if (!dayBuckets[day]) dayBuckets[day] = { count: 0, types: new Set() };
    dayBuckets[day].count++;
    dayBuckets[day].types.add(tx.type);
  }

  // Show all days with data
  console.log('Days with exchange data:');
  for (const [day, data] of Object.entries(dayBuckets).sort()) {
    console.log(`  ${day}: ${data.count} txs [${[...data.types].join(', ')}]`);
  }

  // Count missing days by month
  for (let m = 0; m < 3; m++) {
    const monthStart = new Date(2025, m, 1);
    const monthEnd = new Date(2025, m + 1, 0);
    const daysInMonth = monthEnd.getDate();
    let daysWithData = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dayKey = `2025-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (dayBuckets[dayKey]) daysWithData++;
    }
    const monthNames = ['January', 'February', 'March'];
    console.log(`\n${monthNames[m]}: ${daysWithData} days with data out of ${daysInMonth}`);
  }

  // ---- PART F: What about EXCHANGE_TRADE type (spot trades with BRL pairs)? ----
  console.log('\n\n--- PART F: EXCHANGE_TRADE transactions (spot trades) ---\n');

  const trades = await prisma.transaction.findMany({
    where: { type: 'EXCHANGE_TRADE' },
    select: { id: true, timestamp: true, totalValueUsd: true, rawData: true, externalId: true },
    orderBy: { timestamp: 'asc' },
  });

  console.log(`Total EXCHANGE_TRADE: ${trades.length}`);
  for (const tx of trades) {
    const raw = tx.rawData as any;
    const hasBRL = JSON.stringify(raw || {}).includes('BRL');
    const brlFlag = hasBRL ? ' [BRL]' : '';
    console.log(`  ${tx.timestamp.toISOString().slice(0, 19)} $${Number(tx.totalValueUsd || 0).toFixed(2).padStart(10)} pair=${raw?.symbol || '?'} side=${raw?.side || '?'}${brlFlag}`);
  }

  // ---- PART G: Look for transactions marked with EXCHANGE_FIAT_SELL / EXCHANGE_FIAT_BUY ----
  console.log('\n--- PART G: EXCHANGE_FIAT_SELL and EXCHANGE_FIAT_BUY transactions ---\n');

  const fiatTxs = await prisma.transaction.findMany({
    where: { type: { in: ['EXCHANGE_FIAT_SELL', 'EXCHANGE_FIAT_BUY'] } },
    select: { id: true, type: true, timestamp: true, totalValueUsd: true, rawData: true },
    orderBy: { timestamp: 'asc' },
  });

  console.log(`EXCHANGE_FIAT_SELL/BUY transactions: ${fiatTxs.length}`);
  for (const tx of fiatTxs) {
    const raw = tx.rawData as any;
    console.log(`  ${tx.timestamp.toISOString().slice(0, 19)} ${tx.type} $${Number(tx.totalValueUsd || 0).toFixed(2)} asset=${raw?.asset || raw?.fiatCurrency || '?'}`);
  }

  // ---- PART H: Summary ----
  console.log('\n\n=== SUMMARY ===\n');

  // Check the fetchConvertHistory logic
  // It uses: options.since?.getTime() ?? (now.getTime() - ONE_YEAR_MS)
  // If options.since was not set, it goes back 1 year from sync time

  if (connFull?.lastSyncAt) {
    const syncDate = connFull.lastSyncAt;
    const oneYearBack = new Date(syncDate.getTime() - ONE_YEAR_MS);

    console.log(`The Binance sync was performed on:   ${syncDate.toISOString().slice(0, 10)}`);
    console.log(`With 1-year lookback, earliest is:   ${oneYearBack.toISOString().slice(0, 10)}`);
    console.log(`Earliest actual exchange tx found:   ${earliest?.timestamp.toISOString().slice(0, 10)}`);

    const firstSyncPossible = connFull.createdAt;
    if (firstSyncPossible) {
      const firstSyncOneYearBack = new Date(firstSyncPossible.getTime() - ONE_YEAR_MS);
      console.log(`Connection created on:               ${firstSyncPossible.toISOString().slice(0, 10)}`);
      console.log(`If first sync was on creation day,`);
      console.log(`  earliest data would be from:       ${firstSyncOneYearBack.toISOString().slice(0, 10)}`);
    }
  }

  // Show BRL-related data months
  console.log(`\nBRL data found in these months:`);
  const allTxsWithRaw = await prisma.transaction.findMany({
    where: { source: 'EXCHANGE' },
    select: { timestamp: true, rawData: true, type: true },
  });

  const brlMonths: Record<string, number> = {};
  for (const tx of allTxsWithRaw) {
    const rawStr = JSON.stringify(tx.rawData || {});
    if (rawStr.includes('BRL')) {
      const key = tx.timestamp.toISOString().slice(0, 7);
      brlMonths[key] = (brlMonths[key] || 0) + 1;
    }
  }
  for (const [month, count] of Object.entries(brlMonths).sort()) {
    console.log(`  ${month}: ${count} BRL transactions`);
  }

  console.log('\nBRL converts should have been in Jan-Feb but the EARLIEST exchange data');
  console.log('starts from February 10, 2025. This means:');
  console.log('  - January is completely missing (no exchange data at all)');
  console.log('  - February only has data from the 10th onwards');
  console.log('  - The Feb converts were USDC->SOL (not BRL-related)');
  console.log('  - BRL converts only appear starting March 1st');
}

main().catch(console.error).finally(() => prisma.$disconnect());
