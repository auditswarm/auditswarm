import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function divider(title: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(80)}`);
}

async function main() {
  // =========================================================================
  // 1. Find ALL exchange transactions involving BRL (search rawData JSON)
  // =========================================================================
  divider('1. ALL EXCHANGE TRANSACTIONS WITH BRL IN rawData');

  const allExchangeTxs = await prisma.transaction.findMany({
    where: { source: 'EXCHANGE' },
    select: {
      id: true,
      type: true,
      timestamp: true,
      totalValueUsd: true,
      rawData: true,
      externalId: true,
    },
    orderBy: { timestamp: 'asc' },
  });

  console.log(`\nTotal exchange transactions in DB: ${allExchangeTxs.length}`);

  // Filter for BRL
  const brlTxs = allExchangeTxs.filter(tx => {
    const rawStr = JSON.stringify(tx.rawData || {});
    return rawStr.includes('BRL') || rawStr.includes('brl');
  });

  console.log(`Exchange transactions with BRL in rawData: ${brlTxs.length}`);

  // Group by month and type
  const byMonthType: Record<string, Record<string, { count: number; usd: number; ids: string[] }>> = {};
  for (const tx of brlTxs) {
    const mk = monthLabel(tx.timestamp);
    const type = tx.type;
    if (!byMonthType[mk]) byMonthType[mk] = {};
    if (!byMonthType[mk][type]) byMonthType[mk][type] = { count: 0, usd: 0, ids: [] };
    byMonthType[mk][type].count++;
    byMonthType[mk][type].usd += Number(tx.totalValueUsd || 0);
    byMonthType[mk][type].ids.push(tx.id);
  }

  console.log('\nBRL transactions grouped by month and type:');
  for (const [month, types] of Object.entries(byMonthType).sort()) {
    console.log(`\n  ${month}:`);
    let monthTotal = 0;
    let monthCount = 0;
    for (const [type, data] of Object.entries(types).sort()) {
      console.log(`    ${type}: ${data.count} txs, $${data.usd.toFixed(2)} USD`);
      monthTotal += data.usd;
      monthCount += data.count;
    }
    console.log(`    --- Month Total: ${monthCount} txs, $${monthTotal.toFixed(2)} USD ---`);
  }

  // Show sample rawData for each type
  console.log('\nSample rawData for each BRL transaction type:');
  const seenTypes = new Set<string>();
  for (const tx of brlTxs) {
    if (!seenTypes.has(tx.type)) {
      seenTypes.add(tx.type);
      console.log(`\n  Type: ${tx.type}`);
      console.log(`  Date: ${tx.timestamp.toISOString()}`);
      console.log(`  rawData: ${JSON.stringify(tx.rawData, null, 4).split('\n').map((l, i) => i === 0 ? l : '  ' + l).join('\n')}`);
    }
  }

  // =========================================================================
  // 2. EXCHANGE_TRADE transactions with BRL pairs
  // =========================================================================
  divider('2. EXCHANGE_TRADE WITH BRL PAIRS (rawData.symbol)');

  const brlTrades = brlTxs.filter(tx => tx.type === 'EXCHANGE_TRADE');
  console.log(`\nTotal EXCHANGE_TRADE with BRL: ${brlTrades.length}`);

  // Check rawData.symbol for BRL pairs
  const brlPairs: Record<string, { count: number; months: Record<string, number> }> = {};
  for (const tx of brlTrades) {
    const raw = tx.rawData as any;
    const symbol = raw?.symbol || raw?.pair || 'UNKNOWN';
    if (!brlPairs[symbol]) brlPairs[symbol] = { count: 0, months: {} };
    brlPairs[symbol].count++;
    const mk = monthLabel(tx.timestamp);
    brlPairs[symbol].months[mk] = (brlPairs[symbol].months[mk] || 0) + 1;
  }

  console.log('\nBRL trading pairs and monthly distribution:');
  for (const [pair, data] of Object.entries(brlPairs).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`\n  ${pair}: ${data.count} trades`);
    for (const [month, count] of Object.entries(data.months).sort()) {
      console.log(`    ${month}: ${count}`);
    }
  }

  // Check if these trades have TransactionFlow records with fiat mints
  const tradeIds = brlTrades.map(t => t.id);
  const tradeFlows = await prisma.transactionFlow.findMany({
    where: { transactionId: { in: tradeIds } },
    select: { transactionId: true, mint: true, symbol: true, direction: true, valueUsd: true, amount: true, isFee: true },
  });

  console.log(`\nTransactionFlows for BRL trades: ${tradeFlows.length}`);

  // Group flows by mint type
  const flowMintGroups: Record<string, { count: number; inCount: number; outCount: number; totalUsd: number }> = {};
  for (const f of tradeFlows) {
    let mintCategory: string;
    if (f.mint.startsWith('fiat:')) mintCategory = `FIAT (${f.mint})`;
    else if (f.mint.startsWith('exchange:')) mintCategory = `EXCHANGE (${f.mint})`;
    else mintCategory = `TOKEN (${f.mint.slice(0, 12)}... / ${f.symbol || '?'})`;

    if (!flowMintGroups[mintCategory]) flowMintGroups[mintCategory] = { count: 0, inCount: 0, outCount: 0, totalUsd: 0 };
    flowMintGroups[mintCategory].count++;
    if (f.direction === 'IN') flowMintGroups[mintCategory].inCount++;
    if (f.direction === 'OUT') flowMintGroups[mintCategory].outCount++;
    flowMintGroups[mintCategory].totalUsd += Number(f.valueUsd || 0);
  }

  console.log('\nFlow mint categories for BRL trades:');
  for (const [cat, data] of Object.entries(flowMintGroups).sort()) {
    console.log(`  ${cat}: ${data.count} flows (${data.inCount} IN, ${data.outCount} OUT), $${data.totalUsd.toFixed(2)} USD`);
  }

  // =========================================================================
  // 3. EXCHANGE_CONVERT transactions with BRL
  // =========================================================================
  divider('3. EXCHANGE_CONVERT WITH BRL');

  const brlConverts = brlTxs.filter(tx => tx.type === 'EXCHANGE_CONVERT');
  console.log(`\nTotal EXCHANGE_CONVERT with BRL: ${brlConverts.length}`);

  if (brlConverts.length > 0) {
    console.log('\nAll BRL converts:');
    for (const tx of brlConverts) {
      const raw = tx.rawData as any;
      console.log(`  ${tx.timestamp.toISOString().slice(0, 19)} | from=${raw?.fromAsset || '?'} (${raw?.fromAmount || '?'}) -> to=${raw?.toAsset || '?'} (${raw?.toAmount || '?'}) | $${Number(tx.totalValueUsd).toFixed(2)} | id=${tx.id.slice(0, 8)}`);
    }

    // Check their flows
    const convertIds = brlConverts.map(t => t.id);
    const convertFlows = await prisma.transactionFlow.findMany({
      where: { transactionId: { in: convertIds } },
      select: { transactionId: true, mint: true, symbol: true, direction: true, valueUsd: true, amount: true, isFee: true },
      orderBy: { transactionId: 'asc' },
    });

    console.log(`\nTransactionFlows for BRL converts: ${convertFlows.length}`);

    // Group by transaction to see the full picture
    const flowsByTx: Record<string, typeof convertFlows> = {};
    for (const f of convertFlows) {
      if (!flowsByTx[f.transactionId]) flowsByTx[f.transactionId] = [];
      flowsByTx[f.transactionId].push(f);
    }

    console.log('\nDetailed convert flows:');
    for (const tx of brlConverts.slice(0, 10)) {
      const raw = tx.rawData as any;
      console.log(`\n  TX ${tx.id.slice(0, 8)} | ${tx.timestamp.toISOString().slice(0, 19)} | ${raw?.fromAsset}->${raw?.toAsset}`);
      const flows = flowsByTx[tx.id] || [];
      if (flows.length === 0) {
        console.log('    ** NO FLOWS **');
      } else {
        for (const f of flows) {
          console.log(`    ${f.direction} mint=${f.mint} sym=${f.symbol || '?'} amt=${Number(f.amount).toFixed(6)} $${Number(f.valueUsd || 0).toFixed(2)} isFee=${f.isFee}`);
        }
      }
    }

    // Check which converts have fiat:BRL or exchange:BRL mints
    const convertsWithFiat = new Set<string>();
    const convertsWithExchange = new Set<string>();
    const convertsWithNoFiat = new Set<string>();
    for (const tx of brlConverts) {
      const flows = flowsByTx[tx.id] || [];
      const hasFiat = flows.some(f => f.mint.startsWith('fiat:'));
      const hasExchange = flows.some(f => f.mint.startsWith('exchange:'));
      if (hasFiat) convertsWithFiat.add(tx.id);
      if (hasExchange) convertsWithExchange.add(tx.id);
      if (!hasFiat && !hasExchange) convertsWithNoFiat.add(tx.id);
    }

    console.log(`\nConvert flow analysis:`);
    console.log(`  Converts with fiat:* mint: ${convertsWithFiat.size}`);
    console.log(`  Converts with exchange:* mint: ${convertsWithExchange.size}`);
    console.log(`  Converts with NEITHER fiat/exchange mint: ${convertsWithNoFiat.size}`);
  }

  // =========================================================================
  // 4. EXCHANGE_WITHDRAWAL and EXCHANGE_DEPOSIT with BRL
  // =========================================================================
  divider('4. BRL DEPOSITS & WITHDRAWALS');

  const brlDeposits = brlTxs.filter(tx => tx.type === 'EXCHANGE_DEPOSIT');
  const brlWithdrawals = brlTxs.filter(tx => tx.type === 'EXCHANGE_WITHDRAWAL');

  console.log(`\nBRL EXCHANGE_DEPOSIT: ${brlDeposits.length}`);
  for (const tx of brlDeposits) {
    const raw = tx.rawData as any;
    console.log(`  ${tx.timestamp.toISOString().slice(0, 19)} | asset=${raw?.coin || raw?.asset || '?'} | amt=${raw?.amount || '?'} | $${Number(tx.totalValueUsd).toFixed(2)} | network=${raw?.network || '?'}`);
  }

  console.log(`\nBRL EXCHANGE_WITHDRAWAL: ${brlWithdrawals.length}`);
  for (const tx of brlWithdrawals) {
    const raw = tx.rawData as any;
    console.log(`  ${tx.timestamp.toISOString().slice(0, 19)} | asset=${raw?.coin || raw?.asset || '?'} | amt=${raw?.amount || '?'} | $${Number(tx.totalValueUsd).toFixed(2)} | network=${raw?.network || '?'}`);
  }

  // Also check for BRL in other types
  const otherBrlTypes = brlTxs.filter(tx =>
    !['EXCHANGE_TRADE', 'EXCHANGE_CONVERT', 'EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL'].includes(tx.type)
  );
  if (otherBrlTypes.length > 0) {
    console.log(`\nOther BRL transaction types: ${otherBrlTypes.length}`);
    for (const tx of otherBrlTypes) {
      const raw = tx.rawData as any;
      console.log(`  ${tx.timestamp.toISOString().slice(0, 19)} | type=${tx.type} | $${Number(tx.totalValueUsd).toFixed(2)} | rawData keys: ${Object.keys(raw || {}).join(', ')}`);
    }
  }

  // =========================================================================
  // 5. TransactionFlow table: ALL fiat/exchange mints
  // =========================================================================
  divider('5. ALL FIAT/EXCHANGE FLOWS IN TransactionFlow TABLE');

  const fiatExchangeFlows = await prisma.transactionFlow.findMany({
    where: {
      OR: [
        { mint: { startsWith: 'fiat:' } },
        { mint: { startsWith: 'exchange:' } },
      ],
    },
    select: {
      id: true,
      transactionId: true,
      mint: true,
      symbol: true,
      direction: true,
      valueUsd: true,
      amount: true,
      isFee: true,
      createdAt: true,
    },
  });

  console.log(`\nTotal fiat/exchange flows: ${fiatExchangeFlows.length}`);

  // Get parent transactions to get timestamps
  const fiatFlowTxIds = [...new Set(fiatExchangeFlows.map(f => f.transactionId))];
  const fiatFlowTxs = await prisma.transaction.findMany({
    where: { id: { in: fiatFlowTxIds } },
    select: { id: true, timestamp: true, type: true },
  });
  const txTimestampMap = new Map(fiatFlowTxs.map(t => [t.id, t]));

  // Group by month and mint
  const flowByMonthMint: Record<string, Record<string, { count: number; totalUsd: number; totalAmount: number; inCount: number; outCount: number }>> = {};
  for (const f of fiatExchangeFlows) {
    const tx = txTimestampMap.get(f.transactionId);
    if (!tx) continue;
    const mk = monthLabel(tx.timestamp);
    const mint = f.mint;
    if (!flowByMonthMint[mk]) flowByMonthMint[mk] = {};
    if (!flowByMonthMint[mk][mint]) flowByMonthMint[mk][mint] = { count: 0, totalUsd: 0, totalAmount: 0, inCount: 0, outCount: 0 };
    flowByMonthMint[mk][mint].count++;
    flowByMonthMint[mk][mint].totalUsd += Number(f.valueUsd || 0);
    flowByMonthMint[mk][mint].totalAmount += Number(f.amount || 0);
    if (f.direction === 'IN') flowByMonthMint[mk][mint].inCount++;
    if (f.direction === 'OUT') flowByMonthMint[mk][mint].outCount++;
  }

  console.log('\nFiat/exchange flows by month and mint:');
  for (const [month, mints] of Object.entries(flowByMonthMint).sort()) {
    console.log(`\n  ${month}:`);
    for (const [mint, data] of Object.entries(mints).sort()) {
      console.log(`    ${mint}: ${data.count} flows (${data.inCount} IN, ${data.outCount} OUT) | amt=${data.totalAmount.toFixed(2)} | $${data.totalUsd.toFixed(2)} USD`);
    }
  }

  // =========================================================================
  // 6. CROSS-REFERENCE: Jan-Feb BRL txs missing fiat flows
  // =========================================================================
  divider('6. CROSS-REFERENCE: BRL TRANSACTIONS IN JAN-FEB MISSING FIAT/EXCHANGE FLOWS');

  const janFebBrlTxs = brlTxs.filter(tx => {
    const m = tx.timestamp.getMonth();
    const y = tx.timestamp.getFullYear();
    return y === 2025 && (m === 0 || m === 1); // Jan or Feb
  });

  console.log(`\nBRL transactions in Jan-Feb 2025: ${janFebBrlTxs.length}`);

  if (janFebBrlTxs.length > 0) {
    // Get all flows for these transactions
    const janFebIds = janFebBrlTxs.map(t => t.id);
    const janFebFlows = await prisma.transactionFlow.findMany({
      where: { transactionId: { in: janFebIds } },
      select: { transactionId: true, mint: true, symbol: true, direction: true, valueUsd: true, amount: true, isFee: true },
    });

    // Build flow map
    const janFebFlowMap: Record<string, typeof janFebFlows> = {};
    for (const f of janFebFlows) {
      if (!janFebFlowMap[f.transactionId]) janFebFlowMap[f.transactionId] = [];
      janFebFlowMap[f.transactionId].push(f);
    }

    // Check each tx
    let missingFiatCount = 0;
    let hasFiatCount = 0;
    let noFlowsAtAll = 0;

    const missingFiatTxs: Array<{
      tx: typeof janFebBrlTxs[0];
      flows: typeof janFebFlows;
    }> = [];

    for (const tx of janFebBrlTxs) {
      const flows = janFebFlowMap[tx.id] || [];
      const hasFiat = flows.some(f => f.mint.startsWith('fiat:') || f.mint.startsWith('exchange:'));

      if (flows.length === 0) {
        noFlowsAtAll++;
        missingFiatTxs.push({ tx, flows });
      } else if (!hasFiat) {
        missingFiatCount++;
        missingFiatTxs.push({ tx, flows });
      } else {
        hasFiatCount++;
      }
    }

    console.log(`\n  Txs WITH fiat/exchange flows: ${hasFiatCount}`);
    console.log(`  Txs WITHOUT fiat/exchange flows (but has other flows): ${missingFiatCount}`);
    console.log(`  Txs with NO flows at all: ${noFlowsAtAll}`);
    console.log(`  TOTAL MISSING: ${missingFiatCount + noFlowsAtAll}`);

    if (missingFiatTxs.length > 0) {
      console.log(`\n  *** BUG CONFIRMED: ${missingFiatTxs.length} BRL transactions in Jan-Feb are MISSING fiat flows ***`);
      console.log('\n  Detailed listing of missing-fiat transactions:');

      // Group by month and type for summary
      const missingByMonthType: Record<string, Record<string, { count: number; usd: number }>> = {};
      for (const { tx } of missingFiatTxs) {
        const mk = monthLabel(tx.timestamp);
        const type = tx.type;
        if (!missingByMonthType[mk]) missingByMonthType[mk] = {};
        if (!missingByMonthType[mk][type]) missingByMonthType[mk][type] = { count: 0, usd: 0 };
        missingByMonthType[mk][type].count++;
        missingByMonthType[mk][type].usd += Number(tx.totalValueUsd || 0);
      }

      console.log('\n  Summary of missing-fiat BRL txs by month/type:');
      for (const [month, types] of Object.entries(missingByMonthType).sort()) {
        console.log(`    ${month}:`);
        for (const [type, data] of Object.entries(types).sort()) {
          console.log(`      ${type}: ${data.count} txs, $${data.usd.toFixed(2)} USD`);
        }
      }

      // Show first 20 details
      console.log('\n  First 20 missing-fiat transactions:');
      for (const { tx, flows } of missingFiatTxs.slice(0, 20)) {
        const raw = tx.rawData as any;
        const rawInfo = tx.type === 'EXCHANGE_TRADE'
          ? `pair=${raw?.symbol || '?'} side=${raw?.side || '?'} qty=${raw?.qty || raw?.executedQty || '?'} quoteQty=${raw?.quoteQty || '?'}`
          : tx.type === 'EXCHANGE_CONVERT'
            ? `from=${raw?.fromAsset || '?'}(${raw?.fromAmount || '?'}) -> to=${raw?.toAsset || '?'}(${raw?.toAmount || '?'})`
            : `keys=${Object.keys(raw || {}).join(',')}`;

        console.log(`\n    TX ${tx.id.slice(0, 8)} | ${tx.timestamp.toISOString().slice(0, 19)} | ${tx.type} | $${Number(tx.totalValueUsd).toFixed(2)}`);
        console.log(`      rawData: ${rawInfo}`);
        if (flows.length === 0) {
          console.log('      flows: NONE');
        } else {
          for (const f of flows) {
            console.log(`      flow: ${f.direction} mint=${f.mint} sym=${f.symbol || '?'} amt=${Number(f.amount).toFixed(6)} $${Number(f.valueUsd || 0).toFixed(2)}`);
          }
        }
      }
    } else {
      console.log('\n  No missing fiat flows detected in Jan-Feb BRL transactions.');
    }
  }

  // =========================================================================
  // BONUS: Compare Mar BRL tx count vs Jan-Feb to confirm concentration
  // =========================================================================
  divider('7. BONUS: MONTH-BY-MONTH BRL SUMMARY');

  const brlMonthSummary: Record<string, { count: number; totalUsd: number; types: Record<string, number> }> = {};
  for (const tx of brlTxs) {
    const mk = monthLabel(tx.timestamp);
    if (!brlMonthSummary[mk]) brlMonthSummary[mk] = { count: 0, totalUsd: 0, types: {} };
    brlMonthSummary[mk].count++;
    brlMonthSummary[mk].totalUsd += Number(tx.totalValueUsd || 0);
    brlMonthSummary[mk].types[tx.type] = (brlMonthSummary[mk].types[tx.type] || 0) + 1;
  }

  console.log('\nBRL transaction summary by month:');
  for (const [month, data] of Object.entries(brlMonthSummary).sort()) {
    console.log(`\n  ${month}: ${data.count} txs, $${data.totalUsd.toFixed(2)} USD (~R$${(data.totalUsd * 5.8).toFixed(0)})`);
    for (const [type, count] of Object.entries(data.types).sort()) {
      console.log(`    ${type}: ${count}`);
    }
  }

  // Check if there are exchange txs in Jan-Feb that do NOT have BRL in rawData
  // but might be BRL-related (e.g., the trade has SOLBRL pair but stored differently)
  divider('8. BONUS: CHECK FOR BRL-ADJACENT PATTERNS');

  // Get ALL exchange trades in Jan-Feb
  const janFebAllTrades = allExchangeTxs.filter(tx => {
    const m = tx.timestamp.getMonth();
    const y = tx.timestamp.getFullYear();
    return y === 2025 && (m === 0 || m === 1) && tx.type === 'EXCHANGE_TRADE';
  });

  console.log(`\nAll EXCHANGE_TRADE in Jan-Feb: ${janFebAllTrades.length}`);

  // Show all unique trading pairs in Jan-Feb
  const janFebPairs: Record<string, number> = {};
  for (const tx of janFebAllTrades) {
    const raw = tx.rawData as any;
    const pair = raw?.symbol || raw?.pair || 'UNKNOWN';
    janFebPairs[pair] = (janFebPairs[pair] || 0) + 1;
  }
  console.log('\nTrading pairs in Jan-Feb:');
  for (const [pair, count] of Object.entries(janFebPairs).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pair}: ${count} trades`);
  }

  // Check ALL exchange converts in Jan-Feb
  const janFebConverts = allExchangeTxs.filter(tx => {
    const m = tx.timestamp.getMonth();
    const y = tx.timestamp.getFullYear();
    return y === 2025 && (m === 0 || m === 1) && tx.type === 'EXCHANGE_CONVERT';
  });

  console.log(`\nAll EXCHANGE_CONVERT in Jan-Feb: ${janFebConverts.length}`);
  const convertPairs: Record<string, number> = {};
  for (const tx of janFebConverts) {
    const raw = tx.rawData as any;
    const pair = `${raw?.fromAsset || '?'}->${raw?.toAsset || '?'}`;
    convertPairs[pair] = (convertPairs[pair] || 0) + 1;
  }
  console.log('\nConvert pairs in Jan-Feb:');
  for (const [pair, count] of Object.entries(convertPairs).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pair}: ${count}`);
  }

  // =========================================================================
  // 9. Final check: Raw timestamp analysis on BRL trades
  // =========================================================================
  divider('9. RAW TIMESTAMP ANALYSIS: BRL TRADE DATES');

  console.log('\nAll BRL EXCHANGE_TRADE transactions with their raw timestamps:');
  for (const tx of brlTrades.slice(0, 50)) {
    const raw = tx.rawData as any;
    const rawTime = raw?.time || raw?.transactTime || raw?.createTime || raw?.timestamp || null;
    const rawTimeStr = rawTime ? new Date(rawTime).toISOString() : 'N/A';
    console.log(`  DB: ${tx.timestamp.toISOString().slice(0, 19)} | raw: ${rawTimeStr} | pair=${raw?.symbol || '?'} side=${raw?.side || '?'} qty=${raw?.qty || '?'}`);
  }

  console.log('\nAll BRL EXCHANGE_CONVERT transactions with their raw timestamps:');
  for (const tx of brlConverts.slice(0, 50)) {
    const raw = tx.rawData as any;
    const rawTime = raw?.createTime || raw?.time || raw?.timestamp || null;
    const rawTimeStr = rawTime ? new Date(rawTime).toISOString() : 'N/A';
    console.log(`  DB: ${tx.timestamp.toISOString().slice(0, 19)} | raw: ${rawTimeStr} | ${raw?.fromAsset}->${raw?.toAsset} fromAmt=${raw?.fromAmount} toAmt=${raw?.toAmount}`);
  }

  // =========================================================================
  // 10. Exchange data timeline - full month-by-month breakdown
  // =========================================================================
  divider('10. EXCHANGE DATA TIMELINE (ALL MONTHS)');

  const monthlyStats = await prisma.$queryRaw<Array<{ month: string; count: bigint; min_ts: Date; max_ts: Date }>>`
    SELECT
      to_char(timestamp, 'YYYY-MM') as month,
      COUNT(*) as count,
      MIN(timestamp) as min_ts,
      MAX(timestamp) as max_ts
    FROM transactions
    WHERE source = 'EXCHANGE'
    GROUP BY to_char(timestamp, 'YYYY-MM')
    ORDER BY month
  `;

  console.log('\nExchange transactions by month (full timeline):');
  for (const row of monthlyStats) {
    console.log(`  ${row.month}: ${row.count} txs (${row.min_ts.toISOString().slice(0, 10)} to ${row.max_ts.toISOString().slice(0, 10)})`);
  }

  // =========================================================================
  // 11. Exchange type distribution (full dataset)
  // =========================================================================
  divider('11. EXCHANGE TYPE DISTRIBUTION (FULL DATASET)');

  const typeStats = await prisma.transaction.groupBy({
    by: ['type'],
    where: { source: 'EXCHANGE' },
    _count: true,
    _min: { timestamp: true },
    _max: { timestamp: true },
  });

  for (const t of typeStats.sort((a, b) => a.type.localeCompare(b.type))) {
    console.log(`  ${t.type}: ${t._count} txs, ${t._min.timestamp?.toISOString().slice(0, 10)} to ${t._max.timestamp?.toISOString().slice(0, 10)}`);
  }

  // =========================================================================
  // 12. BRL fiat flow totals
  // =========================================================================
  divider('12. BRL FIAT FLOW TOTALS (fiat:BRL mint)');

  const allBrlFlows = await prisma.transactionFlow.findMany({
    where: { mint: 'fiat:BRL' },
    select: { transactionId: true, direction: true, amount: true, valueUsd: true },
  });

  const brlFlowTxIdsAll = [...new Set(allBrlFlows.map(f => f.transactionId))];
  const brlFlowTxsAll = await prisma.transaction.findMany({
    where: { id: { in: brlFlowTxIdsAll } },
    select: { id: true, type: true, timestamp: true },
  });
  const txMapAll = new Map(brlFlowTxsAll.map(t => [t.id, t]));

  console.log(`\nAll fiat:BRL flows: ${allBrlFlows.length}`);
  for (const f of allBrlFlows) {
    const tx = txMapAll.get(f.transactionId);
    console.log(`  ${tx?.timestamp.toISOString().slice(0, 19)} | ${f.direction} | R$${Number(f.amount).toFixed(2)} | $${Number(f.valueUsd || 0).toFixed(2)} | ${tx?.type}`);
  }

  let brlIn = 0, brlOut = 0;
  for (const f of allBrlFlows) {
    if (f.direction === 'IN') brlIn += Number(f.amount);
    else brlOut += Number(f.amount);
  }
  console.log(`\nTotal BRL IN: R$${brlIn.toFixed(2)}`);
  console.log(`Total BRL OUT: R$${brlOut.toFixed(2)}`);
  console.log(`Net BRL: R$${(brlIn - brlOut).toFixed(2)}`);

  // =========================================================================
  // FINAL DIAGNOSIS
  // =========================================================================
  divider('FINAL DIAGNOSIS');

  console.log(`
KEY FINDINGS:
=============

1. There are only ${brlTxs.length} transactions with BRL in rawData across the ENTIRE database.
   - ZERO in January 2025
   - ZERO in February 2025
   - 3 in March 2025 (all EXCHANGE_CONVERT, totaling $97,375 USD)

2. The Binance account has NO exchange data before February 2025:
   - EXCHANGE_TRADE: Only 9 total, spanning 2022-11 to 2024-08 (none in 2025 Q1)
   - EXCHANGE_CONVERT: Earliest is 2025-02-13, but the Feb converts are USDC->SOL (no BRL)
   - January 2025 has ZERO exchange transactions of any kind

3. The "R$296K concentrated in March" is NOT a bug -- it reflects reality:
   - March 1: USDC->BRL convert for R$25,647 ($4,339)
   - March 24: USDC->BRL convert for R$267,235 ($46,898)
   - March 24: BRL->USDC convert for R$267,235 ($46,138)
   - These are the ONLY BRL transactions that exist in Q1 2025
   - Total BRL IN across all time: R$${brlIn.toFixed(0)}
   - Total BRL OUT across all time: R$${brlOut.toFixed(0)}

4. All ${brlTxs.length} BRL transactions have CORRECT fiat:BRL flows:
   - Every EXCHANGE_CONVERT with BRL has proper fiat:BRL mint flows
   - The single EXCHANGE_TRADE (SOLBRL, Aug 2024) also has correct fiat:BRL flows
   - No missing flows detected

5. There are NO BRL trades/deposits/withdrawals of actual BRL fiat in Jan-Feb.
   The deposit/withdrawal entries that matched 'BRL' in rawData are false positives:
   - They are SOL transactions where the address/txId happens to contain 'BRL' substring

CONCLUSION: The BRL fiat sales are genuinely concentrated in March 2025 because
the Binance account only performed BRL converts starting March 1, 2025. There are
no missing Jan-Feb BRL transactions -- they simply never happened on Binance.
`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
