import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  console.log('==========================================================');
  console.log('SCRIPT 2: Investigate Timestamps (Jan-Mar 2025)');
  console.log('==========================================================\n');

  // ---- PART A: All exchange transactions with full rawData in Jan-Mar ----
  console.log('--- PART A: Exchange transaction timestamps vs rawData timestamps ---\n');

  const start = new Date(2025, 0, 1);
  const end = new Date(2025, 3, 0, 23, 59, 59);

  const txs = await prisma.transaction.findMany({
    where: {
      source: 'EXCHANGE',
      timestamp: { gte: start, lte: end },
    },
    select: { id: true, type: true, timestamp: true, externalId: true, rawData: true, totalValueUsd: true },
    orderBy: { timestamp: 'asc' },
  });

  console.log(`Total exchange transactions in Jan-Mar 2025: ${txs.length}\n`);

  // For each transaction, extract ALL timestamp-like fields from rawData
  const timestampFields = ['createTime', 'orderTime', 'insertTime', 'time', 'timestamp', 'updateTime',
    'completeTime', 'applyTime', 'successTime', 'transactTime'];

  for (const tx of txs) {
    const raw = tx.rawData as any;
    if (!raw) continue;

    const txDate = tx.timestamp.toISOString();
    const txMonth = months[tx.timestamp.getMonth()];

    const rawTimestamps: Record<string, string> = {};
    for (const field of timestampFields) {
      if (raw[field] !== undefined) {
        const val = raw[field];
        // Could be a number (epoch ms) or a string
        if (typeof val === 'number') {
          rawTimestamps[field] = new Date(val).toISOString();
        } else if (typeof val === 'string') {
          const parsed = new Date(val);
          if (!isNaN(parsed.getTime())) {
            rawTimestamps[field] = parsed.toISOString();
          } else {
            rawTimestamps[field] = val;
          }
        }
      }
    }

    // Check for mismatches
    let hasMismatch = false;
    for (const [field, rawDate] of Object.entries(rawTimestamps)) {
      const rawMonth = new Date(rawDate).getMonth();
      if (rawMonth !== tx.timestamp.getMonth()) {
        hasMismatch = true;
      }
    }

    // Show ALL transactions, highlighting mismatches
    const marker = hasMismatch ? ' *** MISMATCH ***' : '';
    console.log(`[${txMonth}] ${tx.type} txTimestamp=${txDate}${marker}`);
    console.log(`  externalId: ${tx.externalId}`);
    console.log(`  totalValueUsd: $${Number(tx.totalValueUsd || 0).toFixed(2)}`);
    if (Object.keys(rawTimestamps).length > 0) {
      for (const [field, val] of Object.entries(rawTimestamps)) {
        const rawMonth = months[new Date(val).getMonth()];
        const monthMark = rawMonth !== txMonth ? ` <-- DIFFERENT MONTH (${rawMonth})` : '';
        console.log(`  rawData.${field}: ${val}${monthMark}`);
      }
    } else {
      console.log(`  rawData has NO timestamp fields`);
    }

    // Show key rawData fields for context
    if (raw.fromAsset || raw.toAsset) {
      console.log(`  convert: ${raw.fromAsset} -> ${raw.toAsset}, fromAmt=${raw.fromAmount}, toAmt=${raw.toAmount}`);
    }
    if (raw.symbol) {
      console.log(`  trade: symbol=${raw.symbol}, side=${raw.side}`);
    }
    if (raw.coin || raw.asset) {
      console.log(`  asset: ${raw.coin || raw.asset}, network=${raw.network || '-'}`);
    }
    console.log('');
  }

  // ---- PART B: Look WIDER - all exchange transactions (full range) ----
  console.log('\n--- PART B: All exchange transactions grouped by month (full date range) ---\n');

  const allTxs = await prisma.transaction.findMany({
    where: { source: 'EXCHANGE' },
    select: { type: true, timestamp: true },
    orderBy: { timestamp: 'asc' },
  });

  const byMonth: Record<string, { count: number; types: Record<string, number> }> = {};
  for (const tx of allTxs) {
    const key = `${tx.timestamp.getFullYear()}-${String(tx.timestamp.getMonth() + 1).padStart(2, '0')}`;
    if (!byMonth[key]) byMonth[key] = { count: 0, types: {} };
    byMonth[key].count++;
    byMonth[key].types[tx.type] = (byMonth[key].types[tx.type] || 0) + 1;
  }

  for (const [month, data] of Object.entries(byMonth).sort()) {
    console.log(`${month}: ${data.count} total`);
    for (const [type, count] of Object.entries(data.types).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }
  }

  // ---- PART C: Check for BRL in rawData across ALL exchange transactions ----
  console.log('\n--- PART C: BRL-containing rawData across ALL exchange txs ---\n');

  const allTxsWithRaw = await prisma.transaction.findMany({
    where: { source: 'EXCHANGE' },
    select: { id: true, type: true, timestamp: true, rawData: true, totalValueUsd: true },
  });

  const brlByMonth: Record<string, { count: number; types: Record<string, number>; totalUsd: number }> = {};
  for (const tx of allTxsWithRaw) {
    const rawStr = JSON.stringify(tx.rawData || {});
    if (!rawStr.includes('BRL')) continue;

    const key = `${tx.timestamp.getFullYear()}-${String(tx.timestamp.getMonth() + 1).padStart(2, '0')}`;
    if (!brlByMonth[key]) brlByMonth[key] = { count: 0, types: {}, totalUsd: 0 };
    brlByMonth[key].count++;
    brlByMonth[key].types[tx.type] = (brlByMonth[key].types[tx.type] || 0) + 1;
    brlByMonth[key].totalUsd += Number(tx.totalValueUsd || 0);
  }

  if (Object.keys(brlByMonth).length === 0) {
    console.log('NO transactions with BRL in rawData found!');
  } else {
    for (const [month, data] of Object.entries(brlByMonth).sort()) {
      console.log(`${month}: ${data.count} BRL txs, $${data.totalUsd.toFixed(2)}`);
      for (const [type, count] of Object.entries(data.types)) {
        console.log(`  ${type}: ${count}`);
      }
    }
  }

  // ---- PART D: Check for timestamp mismatches specifically ----
  console.log('\n--- PART D: Timestamp mismatch analysis (DB timestamp vs rawData timestamps) ---\n');

  let mismatchCount = 0;
  let checkedCount = 0;
  const mismatchByType: Record<string, number> = {};

  for (const tx of allTxsWithRaw) {
    const raw = tx.rawData as any;
    if (!raw) continue;
    checkedCount++;

    for (const field of timestampFields) {
      if (raw[field] !== undefined) {
        let rawDate: Date;
        if (typeof raw[field] === 'number') {
          rawDate = new Date(raw[field]);
        } else {
          rawDate = new Date(raw[field]);
        }

        if (isNaN(rawDate.getTime())) continue;

        // Check if they differ by more than 1 hour (to account for timezone issues)
        const diffMs = Math.abs(tx.timestamp.getTime() - rawDate.getTime());
        if (diffMs > 3600000) { // 1 hour
          mismatchCount++;
          mismatchByType[tx.type] = (mismatchByType[tx.type] || 0) + 1;
          // Show first few mismatches
          if (mismatchCount <= 5) {
            console.log(`MISMATCH: ${tx.type} DB=${tx.timestamp.toISOString()} raw.${field}=${rawDate.toISOString()} diff=${(diffMs / 3600000).toFixed(1)}h`);
          }
          break; // Only count once per tx
        }
      }
    }
  }

  console.log(`\nChecked ${checkedCount} transactions with rawData`);
  console.log(`Mismatches (>1h difference): ${mismatchCount}`);
  if (mismatchCount > 0) {
    console.log('Mismatches by type:');
    for (const [type, count] of Object.entries(mismatchByType)) {
      console.log(`  ${type}: ${count}`);
    }
  }

  // ---- PART E: Specifically check the sync cursors for time range info ----
  console.log('\n--- PART E: Exchange connection sync cursor state ---\n');

  const connections = await prisma.exchangeConnection.findMany({
    select: { id: true, exchangeName: true, syncCursor: true, lastSyncAt: true, status: true },
  });

  for (const conn of connections) {
    console.log(`Connection: ${conn.exchangeName} (${conn.id})`);
    console.log(`  Status: ${conn.status}`);
    console.log(`  Last sync: ${conn.lastSyncAt?.toISOString() || 'never'}`);
    console.log(`  Sync cursor: ${JSON.stringify(conn.syncCursor, null, 2)}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
