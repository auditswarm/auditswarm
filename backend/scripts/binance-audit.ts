/**
 * Binance Full Audit — Direct API vs DB comparison.
 *
 * This script:
 *   1. Fetches REAL current balances from Binance (spot + earn + margin + futures)
 *   2. Reconstructs expected balances from ALL DB transaction flows
 *   3. Reconstructs expected balances from RAW Binance API data (fresh fetch)
 *   4. Compares all three and writes detailed reports
 *
 * Output files in scripts/audit-output/:
 *   - real-balances.json        → Current Binance account balances
 *   - db-flows-by-asset.json    → All DB flows grouped by asset
 *   - api-raw-data.json         → Raw API data for all transaction types
 *   - api-reconstructed.json    → Balances reconstructed from API data
 *   - comparison.json           → Side-by-side comparison
 *   - report.txt                → Human-readable report
 *
 * Usage:
 *   cd auditswarm/backend
 *   NODE_PATH=libs/database/node_modules npx tsx scripts/binance-audit.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createDecipheriv } from 'crypto';
import { MainClient } from 'binance';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const OUTPUT_DIR = join(__dirname, 'audit-output');
mkdirSync(OUTPUT_DIR, { recursive: true });

function writeJson(name: string, data: any) {
  writeFileSync(join(OUTPUT_DIR, name), JSON.stringify(data, null, 2));
  console.log(`  Wrote ${name}`);
}

function writeTxt(name: string, text: string) {
  writeFileSync(join(OUTPUT_DIR, name), text);
  console.log(`  Wrote ${name}`);
}

// ========== Crypto ==========
function decrypt(encryptedHex: string, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey, 'hex');
  const iv = Buffer.from(encryptedHex.slice(0, 32), 'hex');
  const authTag = Buffer.from(encryptedHex.slice(32, 64), 'hex');
  const ciphertext = encryptedHex.slice(64);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let d = decipher.update(ciphertext, 'hex', 'utf8');
  d += decipher.final('utf8');
  return d;
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ========== STEP 1: Real Binance Balances ==========
async function fetchRealBalances(client: MainClient) {
  console.log('\n=== STEP 1: Fetching Real Binance Balances ===');
  const balances: Record<string, { free: number; locked: number; total: number; source: string[] }> = {};

  function add(asset: string, free: number, locked: number, source: string) {
    if (!balances[asset]) balances[asset] = { free: 0, locked: 0, total: 0, source: [] };
    balances[asset].free += free;
    balances[asset].locked += locked;
    balances[asset].total += (free + locked);
    if (!balances[asset].source.includes(source)) balances[asset].source.push(source);
  }

  // Spot
  try {
    const account = await client.getAccountInformation();
    for (const b of account.balances) {
      const free = parseFloat(String((b as any).free));
      const locked = parseFloat(String((b as any).locked));
      if (free > 0 || locked > 0) add((b as any).asset, free, locked, 'SPOT');
    }
    console.log(`  Spot: ${Object.keys(balances).length} assets with balance`);
  } catch (e: any) { console.log(`  Spot: FAILED - ${e.message}`); }

  // Simple Earn (Flexible)
  try {
    const flex = await (client as any).getFlexibleProductPosition?.({ size: 100 });
    if (Array.isArray(flex?.rows ?? flex)) {
      const rows = flex?.rows ?? flex;
      for (const p of rows) {
        const amount = parseFloat(p.totalAmount ?? p.freeAmount ?? '0');
        if (amount > 0) add(p.asset, amount, 0, 'EARN_FLEXIBLE');
      }
    }
  } catch (e: any) { console.log(`  Earn (flexible): ${e.message?.slice(0, 80)}`); }

  // Simple Earn (Locked)
  try {
    const locked = await (client as any).getLockedProductPosition?.({ size: 100 });
    if (Array.isArray(locked?.rows ?? locked)) {
      const rows = locked?.rows ?? locked;
      for (const p of rows) {
        const amount = parseFloat(p.amount ?? '0');
        if (amount > 0) add(p.asset, 0, amount, 'EARN_LOCKED');
      }
    }
  } catch (e: any) { console.log(`  Earn (locked): ${e.message?.slice(0, 80)}`); }

  // Margin
  try {
    const margin = await (client as any).getMarginAccountInfo?.();
    if (margin?.userAssets) {
      for (const a of margin.userAssets) {
        const free = parseFloat(a.free ?? '0');
        const locked = parseFloat(a.locked ?? '0');
        if (free > 0 || locked > 0) add(a.asset, free, locked, 'MARGIN');
      }
    }
  } catch (e: any) { console.log(`  Margin: ${e.message?.slice(0, 80)}`); }

  // Futures (USDM)
  try {
    const futures = await (client as any).getBalance?.();
    if (Array.isArray(futures)) {
      for (const f of futures) {
        const bal = parseFloat(f.balance ?? '0');
        if (bal > 0) add(f.asset, bal, 0, 'FUTURES_USDM');
      }
    }
  } catch (e: any) { console.log(`  Futures: ${e.message?.slice(0, 80)}`); }

  // Funding
  try {
    const funding = await (client as any).getFundingAsset?.({});
    if (Array.isArray(funding)) {
      for (const f of funding) {
        const free = parseFloat(f.free ?? '0');
        const locked = parseFloat(f.locked ?? '0');
        if (free > 0 || locked > 0) add(f.asset, free, locked, 'FUNDING');
      }
    }
  } catch (e: any) { console.log(`  Funding: ${e.message?.slice(0, 80)}`); }

  writeJson('real-balances.json', balances);
  return balances;
}

// ========== STEP 2: DB Flow Reconstruction ==========
async function reconstructFromDB(connectionId: string) {
  console.log('\n=== STEP 2: Reconstructing Balances from DB Flows ===');

  // Get ALL flows (including deposits, withdrawals, fees)
  const flows = await prisma.$queryRaw<{
    symbol: string;
    type: string;
    direction: string;
    is_fee: boolean;
    count: bigint;
    total_amount: string;
    total_usd: string;
  }[]>`
    SELECT
      tf."symbol",
      t."type",
      tf."direction",
      tf."isFee" AS "is_fee",
      COUNT(*)::bigint AS "count",
      SUM(tf."amount")::text AS "total_amount",
      SUM(COALESCE(tf."valueUsd", 0))::text AS "total_usd"
    FROM transaction_flows tf
    JOIN transactions t ON t.id = tf."transactionId"
    WHERE tf."exchangeConnectionId" = ${connectionId}
    GROUP BY tf."symbol", t."type", tf."direction", tf."isFee"
    ORDER BY tf."symbol", t."type"
  `;

  // Write raw flow data
  const flowData = flows.map(f => ({
    symbol: f.symbol,
    type: f.type,
    direction: f.direction,
    isFee: f.is_fee,
    count: Number(f.count),
    totalAmount: parseFloat(f.total_amount),
    totalUsd: parseFloat(f.total_usd),
  }));
  writeJson('db-flows-by-asset.json', flowData);

  // Reconstruct balances: IN adds, OUT subtracts
  const balances: Record<string, {
    totalIn: number;
    totalOut: number;
    feeOut: number;
    net: number;
    byType: Record<string, { in: number; out: number; feeOut: number }>;
  }> = {};

  for (const f of flowData) {
    if (!balances[f.symbol]) {
      balances[f.symbol] = { totalIn: 0, totalOut: 0, feeOut: 0, net: 0, byType: {} };
    }
    const b = balances[f.symbol];
    if (!b.byType[f.type]) b.byType[f.type] = { in: 0, out: 0, feeOut: 0 };

    if (f.isFee) {
      b.feeOut += f.totalAmount;
      b.byType[f.type].feeOut += f.totalAmount;
    } else if (f.direction === 'IN') {
      b.totalIn += f.totalAmount;
      b.byType[f.type].in += f.totalAmount;
    } else {
      b.totalOut += f.totalAmount;
      b.byType[f.type].out += f.totalAmount;
    }
  }

  for (const [sym, b] of Object.entries(balances)) {
    b.net = b.totalIn - b.totalOut - b.feeOut;
  }

  writeJson('db-reconstructed-balances.json', balances);
  return balances;
}

// ========== STEP 3: Fresh API Data Fetch ==========
async function fetchRawApiData(client: MainClient) {
  console.log('\n=== STEP 3: Fetching Raw API Transaction History ===');

  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const earliest = now - ONE_YEAR_MS;
  const apiData: Record<string, any[]> = {
    deposits: [],
    withdrawals: [],
    trades: [],
    converts: [],
    dust: [],
    fiatPayments: [],
    staking: [],
  };

  // Deposits
  console.log('  Fetching deposits...');
  let windowEnd = now;
  while (windowEnd > earliest) {
    const windowStart = Math.max(windowEnd - NINETY_DAYS, earliest);
    let offset = 0;
    while (true) {
      try {
        const deps = await client.getDepositHistory({
          startTime: windowStart, endTime: windowEnd, offset, limit: 1000, status: '1' as any,
        });
        if (!Array.isArray(deps) || deps.length === 0) break;
        apiData.deposits.push(...deps);
        if (deps.length < 1000) break;
        offset += 1000;
      } catch { break; }
      await delay(200);
    }
    windowEnd = windowStart;
    await delay(100);
  }
  console.log(`    ${apiData.deposits.length} deposits`);

  // Withdrawals
  console.log('  Fetching withdrawals...');
  windowEnd = now;
  while (windowEnd > earliest) {
    const windowStart = Math.max(windowEnd - NINETY_DAYS, earliest);
    let offset = 0;
    while (true) {
      try {
        const wds = await client.getWithdrawHistory({
          startTime: windowStart, endTime: windowEnd, offset, limit: 1000, status: '6' as any,
        });
        if (!Array.isArray(wds) || wds.length === 0) break;
        apiData.withdrawals.push(...wds);
        if (wds.length < 1000) break;
        offset += 1000;
      } catch { break; }
      await delay(200);
    }
    windowEnd = windowStart;
    await delay(100);
  }
  console.log(`    ${apiData.withdrawals.length} withdrawals`);

  // Spot trades (key pairs)
  console.log('  Fetching spot trades...');
  const tradePairs = [
    'SOLUSDT', 'SOLUSDC', 'SOLBTC', 'SOLBNB', 'SOLBRL', 'SOLFDUSD',
    'BTCUSDT', 'BTCUSDC', 'BTCBUSD', 'BTCBRL',
    'ETHUSDT', 'ETHUSDC', 'ETHBTC', 'ETHBUSD',
    'BNBUSDT', 'BNBUSDC', 'BNBBTC', 'BNBBUSD', 'BNBFDUSD', 'BNBBRL',
    'ADAUSDT', 'DOTUSDT', 'XRPUSDT', 'DOGEUSDT',
    'LINKUSDT', 'UNIUSDT', 'LTCUSDT', 'ATOMUSDT',
    'SUIUSDT', 'JUPUSDT', 'WIFUSDT', 'BONKUSDT',
  ];

  // Validate symbols first
  let validSymbols: Set<string>;
  try {
    const info = await client.getExchangeInfo();
    validSymbols = new Set(info.symbols.map(s => s.symbol));
  } catch {
    validSymbols = new Set(tradePairs);
  }

  for (const pair of tradePairs) {
    if (!validSymbols.has(pair)) continue;
    try {
      const trades = await client.getAccountTradeList({ symbol: pair, limit: 1000 });
      if (Array.isArray(trades) && trades.length > 0) {
        for (const t of trades) (t as any)._symbol = pair;
        apiData.trades.push(...trades);
        console.log(`    ${pair}: ${trades.length} trades`);
      }
    } catch { /* skip invalid */ }
    await delay(100);
  }
  console.log(`    Total: ${apiData.trades.length} trades`);

  // Converts
  console.log('  Fetching convert history...');
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  windowEnd = now;
  const convertEarliest = now - ONE_YEAR_MS;
  while (windowEnd > convertEarliest) {
    const windowStart = Math.max(windowEnd - THIRTY_DAYS, convertEarliest);
    try {
      const response = await (client as any).getConvertTradeHistory({
        startTime: windowStart, endTime: windowEnd, limit: 1000,
      });
      const list = (response as any)?.list ?? response ?? [];
      if (Array.isArray(list) && list.length > 0) {
        apiData.converts.push(...list);
      }
    } catch { /* skip */ }
    windowEnd = windowStart;
    await delay(200);
  }
  console.log(`    ${apiData.converts.length} converts`);

  // Dust log
  console.log('  Fetching dust log...');
  windowEnd = now;
  while (windowEnd > earliest) {
    const windowStart = Math.max(windowEnd - NINETY_DAYS, earliest);
    try {
      const dustLog = await (client as any).getDustLog?.({ startTime: windowStart, endTime: windowEnd });
      const results = dustLog?.userAssetDribbletDetails ?? dustLog?.results?.rows ?? [];
      if (Array.isArray(results)) {
        apiData.dust.push(...results);
      }
    } catch { /* skip */ }
    windowEnd = windowStart;
    await delay(200);
  }
  console.log(`    ${apiData.dust.length} dust entries`);

  // Fiat payments
  console.log('  Fetching fiat payments...');
  for (const transactionType of ['0', '1']) {
    try {
      const resp = await client.getFiatPaymentsHistory({ transactionType: transactionType as any, page: 1, rows: 500 });
      const data = (resp as any).data;
      if (Array.isArray(data)) {
        for (const p of data) (p as any)._isBuy = transactionType === '0';
        apiData.fiatPayments.push(...data);
      }
    } catch { /* skip */ }
    await delay(200);
  }
  console.log(`    ${apiData.fiatPayments.length} fiat payments`);

  // Staking (ETH + SOL)
  console.log('  Fetching staking history...');
  try {
    const ethStaking = await (client as any).getEthStakingHistory?.({ startTime: earliest, endTime: now });
    if (Array.isArray(ethStaking?.rows)) apiData.staking.push(...ethStaking.rows.map((r: any) => ({ ...r, _type: 'ETH_STAKE' })));
  } catch { /* skip */ }
  try {
    const solStaking = await (client as any).getStakingHistory?.({ product: 'SOL', startTime: earliest, endTime: now });
    if (Array.isArray(solStaking?.rows ?? solStaking)) {
      const rows = solStaking?.rows ?? solStaking;
      apiData.staking.push(...rows.map((r: any) => ({ ...r, _type: 'SOL_STAKE' })));
    }
  } catch { /* skip */ }
  console.log(`    ${apiData.staking.length} staking entries`);

  writeJson('api-raw-data.json', apiData);
  return apiData;
}

// ========== STEP 4: Reconstruct from API ==========
function reconstructFromApi(apiData: Record<string, any[]>) {
  console.log('\n=== STEP 4: Reconstructing Balances from API Data ===');

  const balances: Record<string, {
    totalIn: number;
    totalOut: number;
    feeOut: number;
    net: number;
    bySource: Record<string, { in: number; out: number; fee: number }>;
  }> = {};

  function track(asset: string, amount: number, direction: 'in' | 'out' | 'fee', source: string) {
    if (!asset || amount === 0) return;
    const a = asset.toUpperCase();
    if (!balances[a]) balances[a] = { totalIn: 0, totalOut: 0, feeOut: 0, net: 0, bySource: {} };
    if (!balances[a].bySource[source]) balances[a].bySource[source] = { in: 0, out: 0, fee: 0 };
    const b = balances[a];
    const s = b.bySource[source];
    if (direction === 'in') { b.totalIn += amount; s.in += amount; }
    else if (direction === 'out') { b.totalOut += amount; s.out += amount; }
    else { b.feeOut += amount; s.fee += amount; }
  }

  // Deposits = money IN to exchange
  for (const d of apiData.deposits) {
    track(d.coin, parseFloat(d.amount), 'in', 'DEPOSIT');
  }

  // Withdrawals = money OUT of exchange (amount + fee)
  for (const w of apiData.withdrawals) {
    track(w.coin, parseFloat(w.amount), 'out', 'WITHDRAWAL');
    if (parseFloat(w.transactionFee) > 0) {
      track(w.coin, parseFloat(w.transactionFee), 'fee', 'WITHDRAWAL_FEE');
    }
  }

  // Trades
  const knownQuotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'BNB', 'BRL', 'EUR', 'USD', 'TRY'];
  function parseSymbol(symbol: string): { base: string; quote: string } {
    for (const q of knownQuotes) {
      if (symbol.endsWith(q)) return { base: symbol.slice(0, -q.length), quote: q };
    }
    return { base: symbol.slice(0, -4), quote: symbol.slice(-4) };
  }

  for (const t of apiData.trades) {
    const { base, quote } = parseSymbol((t as any)._symbol ?? '');
    const qty = parseFloat(t.qty);
    const quoteQty = parseFloat(t.quoteQty);
    const commission = parseFloat(t.commission);

    if (t.isBuyer) {
      track(base, qty, 'in', 'TRADE_BUY');
      track(quote, quoteQty, 'out', 'TRADE_BUY');
    } else {
      track(base, qty, 'out', 'TRADE_SELL');
      track(quote, quoteQty, 'in', 'TRADE_SELL');
    }

    if (commission > 0) {
      track(t.commissionAsset, commission, 'fee', 'TRADE_FEE');
    }
  }

  // Converts: fromAsset OUT, toAsset IN
  for (const c of apiData.converts) {
    track(c.fromAsset, parseFloat(c.fromAmount), 'out', 'CONVERT');
    track(c.toAsset, parseFloat(c.toAmount), 'in', 'CONVERT');
  }

  // Dust: multiple small assets OUT → BNB IN
  for (const d of apiData.dust) {
    if (d.userAssetDribblets) {
      for (const dr of d.userAssetDribblets) {
        track(dr.fromAsset, parseFloat(dr.amount ?? '0'), 'out', 'DUST');
        track('BNB', parseFloat(dr.transferedAmount ?? '0'), 'in', 'DUST');
      }
    }
  }

  // Fiat payments
  for (const f of apiData.fiatPayments) {
    if (f.status !== 'Completed') continue;
    if ((f as any)._isBuy) {
      track(f.cryptoCurrency, parseFloat(f.obtainAmount), 'in', 'FIAT_BUY');
      // Fiat side (BRL, etc.) we don't track on exchange
    } else {
      track(f.cryptoCurrency, parseFloat(f.obtainAmount ?? f.totalAmount ?? '0'), 'out', 'FIAT_SELL');
    }
  }

  // Calculate net
  for (const [asset, b] of Object.entries(balances)) {
    b.net = b.totalIn - b.totalOut - b.feeOut;
  }

  writeJson('api-reconstructed-balances.json', balances);
  return balances;
}

// ========== STEP 5: Compare ==========
function compareAll(
  real: Record<string, any>,
  dbRecon: Record<string, any>,
  apiRecon: Record<string, any>,
) {
  console.log('\n=== STEP 5: Comparing All Sources ===');

  const allAssets = new Set([
    ...Object.keys(real),
    ...Object.keys(dbRecon),
    ...Object.keys(apiRecon),
  ]);

  const rows: any[] = [];
  const report: string[] = [];
  report.push('=' .repeat(100));
  report.push('  BINANCE BALANCE AUDIT REPORT');
  report.push('=' .repeat(100));
  report.push(`  Generated: ${new Date().toISOString()}`);
  report.push('');

  report.push('  LEGEND:');
  report.push('    Real     = Current Binance account balance (spot + earn + margin + futures)');
  report.push('    DB Recon = Balance reconstructed from DB transaction flows (deposits - withdrawals + trades + converts)');
  report.push('    API Recon = Balance reconstructed from fresh Binance API data (same logic, raw data)');
  report.push('');

  report.push(
    '  ' +
    'ASSET'.padEnd(8) +
    'REAL BAL'.padStart(16) +
    'DB RECON'.padStart(16) +
    'API RECON'.padStart(16) +
    'DB DIFF'.padStart(16) +
    'API DIFF'.padStart(16) +
    'STATUS'.padStart(12)
  );
  report.push('  ' + '-'.repeat(96));

  for (const asset of [...allAssets].sort()) {
    const realBal = real[asset]?.total ?? 0;
    const dbNet = dbRecon[asset]?.net ?? 0;
    const apiNet = apiRecon[asset]?.net ?? 0;
    const dbDiff = dbNet - realBal;
    const apiDiff = apiNet - realBal;

    // Skip assets with no meaningful activity
    if (Math.abs(realBal) < 0.000001 && Math.abs(dbNet) < 0.000001 && Math.abs(apiNet) < 0.000001) continue;

    const status = Math.abs(dbDiff) < 0.01 && Math.abs(apiDiff) < 0.01 ? 'OK' :
                   Math.abs(apiDiff) < 0.01 ? 'DB_MISMATCH' : 'MISMATCH';

    rows.push({
      asset,
      realBalance: realBal,
      dbReconstructed: dbNet,
      apiReconstructed: apiNet,
      dbDiff,
      apiDiff,
      status,
      dbDetail: dbRecon[asset] ?? null,
      apiDetail: apiRecon[asset] ?? null,
      realDetail: real[asset] ?? null,
    });

    report.push(
      '  ' +
      asset.padEnd(8) +
      realBal.toFixed(8).padStart(16) +
      dbNet.toFixed(8).padStart(16) +
      apiNet.toFixed(8).padStart(16) +
      (dbDiff >= 0 ? '+' : '') + dbDiff.toFixed(8).padStart(15) +
      (apiDiff >= 0 ? '+' : '') + apiDiff.toFixed(8).padStart(15) +
      status.padStart(12)
    );
  }

  report.push('');
  report.push('  SUMMARY:');
  const total = rows.length;
  const ok = rows.filter(r => r.status === 'OK').length;
  const dbMismatch = rows.filter(r => r.status === 'DB_MISMATCH').length;
  const mismatch = rows.filter(r => r.status === 'MISMATCH').length;
  report.push(`    Total assets: ${total}`);
  report.push(`    OK: ${ok}`);
  report.push(`    DB mismatch (API ok): ${dbMismatch}`);
  report.push(`    Full mismatch: ${mismatch}`);

  // Detailed breakdowns for mismatched assets
  const mismatched = rows.filter(r => r.status !== 'OK');
  if (mismatched.length > 0) {
    report.push('');
    report.push('  DETAILED BREAKDOWNS FOR MISMATCHED ASSETS:');
    report.push('');

    for (const row of mismatched) {
      report.push(`  --- ${row.asset} ---`);
      report.push(`    Real balance: ${row.realBalance}`);
      report.push(`    DB reconstructed: ${row.dbReconstructed} (diff: ${row.dbDiff.toFixed(8)})`);
      report.push(`    API reconstructed: ${row.apiReconstructed} (diff: ${row.apiDiff.toFixed(8)})`);

      if (row.dbDetail) {
        report.push('    DB flows by type:');
        for (const [type, detail] of Object.entries(row.dbDetail.byType ?? {})) {
          const d = detail as any;
          report.push(`      ${type.padEnd(25)} IN: ${d.in.toFixed(8).padStart(16)}  OUT: ${d.out.toFixed(8).padStart(16)}  FEE: ${d.feeOut.toFixed(8).padStart(16)}`);
        }
      }

      if (row.apiDetail) {
        report.push('    API flows by source:');
        for (const [src, detail] of Object.entries(row.apiDetail.bySource ?? {})) {
          const d = detail as any;
          report.push(`      ${src.padEnd(25)} IN: ${d.in.toFixed(8).padStart(16)}  OUT: ${d.out.toFixed(8).padStart(16)}  FEE: ${d.fee.toFixed(8).padStart(16)}`);
        }
      }

      report.push('');
    }
  }

  writeJson('comparison.json', rows);
  writeTxt('report.txt', report.join('\n'));
  return rows;
}

// ========== Main ==========
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  Binance Full Audit');
  console.log('='.repeat(60));

  const ENCRYPTION_KEY = process.env.EXCHANGE_ENCRYPTION_KEY ?? 'ef6b7e0342cd23ed007cb51aaecf447ef6a6138c882b0de9931c719967f11955';

  const connection = await prisma.exchangeConnection.findFirst({
    where: { exchangeName: 'binance', status: 'ACTIVE' },
  });
  if (!connection) { console.error('No active Binance connection'); process.exit(1); }

  const apiKey = decrypt(connection.encryptedApiKey, ENCRYPTION_KEY);
  const apiSecret = decrypt(connection.encryptedApiSecret, ENCRYPTION_KEY);
  const client = new MainClient({ api_key: apiKey, api_secret: apiSecret });

  console.log(`  Connection: ${connection.id}`);

  // Step 1: Real balances
  const realBalances = await fetchRealBalances(client);

  // Step 2: Reconstruct from DB
  const dbRecon = await reconstructFromDB(connection.id);

  // Step 3: Fetch raw API data
  const apiData = await fetchRawApiData(client);

  // Step 4: Reconstruct from API
  const apiRecon = reconstructFromApi(apiData);

  // Step 5: Compare
  const comparison = compareAll(realBalances, dbRecon, apiRecon);

  console.log('\n' + '='.repeat(60));
  console.log('  Audit Complete! Files in scripts/audit-output/');
  console.log('='.repeat(60));

  // Print summary table
  console.log('\n  QUICK SUMMARY:');
  for (const row of comparison) {
    const mark = row.status === 'OK' ? 'v' : row.status === 'DB_MISMATCH' ? '~' : 'X';
    console.log(`  [${mark}] ${row.asset.padEnd(6)} Real: ${row.realBalance.toFixed(4).padStart(14)}  DB: ${row.dbReconstructed.toFixed(4).padStart(14)}  API: ${row.apiReconstructed.toFixed(4).padStart(14)}  Diff: ${row.dbDiff.toFixed(4).padStart(12)}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
