/**
 * Binance Deep Audit — fetches ALL sources with proper windowing.
 *
 * Fixes from first pass:
 * - Universal transfers: 30-day windows (max 90 days)
 * - Dividends: 90-day windows (max 180 days)
 * - Earn rewards: 90-day windows
 * - Flexible subscribe/redeem: 90-day windows
 * - Fiat orders: already working (found 5 BRL orders!)
 *
 * Usage:
 *   cd auditswarm/backend
 *   NODE_PATH=libs/database/node_modules npx tsx scripts/binance-deep-audit.ts
 */

import { PrismaClient } from '@prisma/client';
import { createDecipheriv } from 'crypto';
import { MainClient } from 'binance';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const OUTPUT_DIR = join(__dirname, 'audit-output');
mkdirSync(OUTPUT_DIR, { recursive: true });

function writeJson(name: string, data: any) {
  writeFileSync(join(OUTPUT_DIR, name), JSON.stringify(data, null, 2));
  console.log(`  >> ${name}`);
}

function writeTxt(name: string, text: string) {
  writeFileSync(join(OUTPUT_DIR, name), text);
  console.log(`  >> ${name}`);
}

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
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  Binance Deep Audit (all sources, windowed)');
  console.log('='.repeat(60));

  const ENCRYPTION_KEY = process.env.EXCHANGE_ENCRYPTION_KEY ?? 'ef6b7e0342cd23ed007cb51aaecf447ef6a6138c882b0de9931c719967f11955';
  const conn = await prisma.exchangeConnection.findFirst({ where: { exchangeName: 'binance', status: 'ACTIVE' } });
  if (!conn) { console.error('No connection'); process.exit(1); }
  const client = new MainClient({
    api_key: decrypt(conn.encryptedApiKey, ENCRYPTION_KEY),
    api_secret: decrypt(conn.encryptedApiSecret, ENCRYPTION_KEY),
  });

  const now = Date.now();
  const earliest = now - ONE_YEAR_MS;

  // Load existing audit data (from previous run)
  let apiData: any;
  try {
    apiData = JSON.parse(readFileSync(join(OUTPUT_DIR, 'api-raw-data.json'), 'utf8'));
    console.log('  Loaded existing api-raw-data.json');
  } catch {
    console.log('  No existing api-raw-data.json, run binance-audit.ts first');
    process.exit(1);
  }

  const extraSources: Record<string, any[]> = {};

  // ========== Universal Transfers (30-day windows) ==========
  console.log('\n--- Universal Transfers ---');
  const transferTypes = [
    'MAIN_UMFUTURE', 'UMFUTURE_MAIN', 'MAIN_MARGIN', 'MARGIN_MAIN',
    'MAIN_FUNDING', 'FUNDING_MAIN', 'MAIN_CMFUTURE', 'CMFUTURE_MAIN',
  ];

  extraSources.universalTransfers = [];
  for (const type of transferTypes) {
    let wEnd = now;
    while (wEnd > earliest) {
      const wStart = Math.max(wEnd - THIRTY_DAYS, earliest);
      try {
        const resp = await (client as any).getUniversalTransferHistory?.({
          type, startTime: wStart, endTime: wEnd, size: 100,
        });
        const rows = (resp as any)?.rows ?? [];
        if (Array.isArray(rows) && rows.length > 0) {
          for (const r of rows) r._transferType = type;
          extraSources.universalTransfers.push(...rows);
        }
      } catch { /* skip */ }
      wEnd = wStart;
      await delay(100);
    }
  }
  console.log(`  Universal transfers: ${extraSources.universalTransfers.length}`);
  for (const t of extraSources.universalTransfers) {
    console.log(`    ${t._transferType} ${t.asset} ${t.amount} @ ${new Date(t.timestamp ?? t.time).toISOString().slice(0,19)}`);
  }

  // ========== Asset Dividends (90-day windows) ==========
  console.log('\n--- Asset Dividends ---');
  extraSources.dividends = [];
  let wEnd = now;
  while (wEnd > earliest) {
    const wStart = Math.max(wEnd - (170 * 24 * 60 * 60 * 1000), earliest); // slightly under 180 days
    try {
      let offset = 0;
      while (true) {
        const resp = await (client as any).getAssetDividendRecord?.({
          startTime: wStart, endTime: wEnd, limit: 500, offset,
        });
        const rows = (resp as any)?.rows ?? [];
        if (!Array.isArray(rows) || rows.length === 0) break;
        extraSources.dividends.push(...rows);
        if (rows.length < 500) break;
        offset += 500;
        await delay(200);
      }
    } catch (e: any) {
      if (!e.message?.includes('180 days')) console.log(`    Dividend error: ${e.message?.slice(0, 60)}`);
    }
    wEnd = wStart;
    await delay(100);
  }
  console.log(`  Dividends: ${extraSources.dividends.length}`);
  const divByAsset: Record<string, number> = {};
  for (const d of extraSources.dividends) {
    const a = d.asset ?? d.enInfo?.asset ?? '?';
    divByAsset[a] = (divByAsset[a] ?? 0) + parseFloat(d.amount ?? '0');
  }
  for (const [a, total] of Object.entries(divByAsset)) {
    console.log(`    ${a}: ${total.toFixed(8)}`);
  }

  // ========== Simple Earn Rewards (90-day windows) ==========
  console.log('\n--- Simple Earn Rewards ---');
  extraSources.earnRewards = [];
  for (const rewardType of ['BONUS', 'REALTIME', 'REWARDS'] as const) {
    wEnd = now;
    while (wEnd > earliest) {
      const wStart = Math.max(wEnd - NINETY_DAYS, earliest);
      try {
        let page = 1;
        while (true) {
          const resp = await (client as any).getFlexibleRewardsHistory?.({
            type: rewardType, startTime: wStart, endTime: wEnd, size: 100, current: page,
          });
          const rows = (resp as any)?.rows ?? [];
          if (!Array.isArray(rows) || rows.length === 0) break;
          for (const r of rows) r._rewardType = rewardType;
          extraSources.earnRewards.push(...rows);
          if (rows.length < 100) break;
          page++;
          await delay(200);
        }
      } catch { /* skip */ }
      wEnd = wStart;
      await delay(100);
    }
  }
  // Locked earn rewards
  wEnd = now;
  while (wEnd > earliest) {
    const wStart = Math.max(wEnd - NINETY_DAYS, earliest);
    try {
      let page = 1;
      while (true) {
        const resp = await (client as any).getLockedRewardsHistory?.({
          startTime: wStart, endTime: wEnd, size: 100, current: page,
        });
        const rows = (resp as any)?.rows ?? [];
        if (!Array.isArray(rows) || rows.length === 0) break;
        for (const r of rows) r._rewardType = 'LOCKED';
        extraSources.earnRewards.push(...rows);
        if (rows.length < 100) break;
        page++;
        await delay(200);
      }
    } catch { /* skip */ }
    wEnd = wStart;
    await delay(100);
  }
  console.log(`  Earn rewards: ${extraSources.earnRewards.length}`);
  const rewardByAsset: Record<string, number> = {};
  for (const r of extraSources.earnRewards) {
    const a = r.asset ?? r.rewards?.[0]?.asset ?? '?';
    const amt = parseFloat(r.amount ?? r.rewards?.[0]?.amount ?? '0');
    rewardByAsset[a] = (rewardByAsset[a] ?? 0) + amt;
  }
  for (const [a, total] of Object.entries(rewardByAsset)) {
    console.log(`    ${a}: ${total.toFixed(8)}`);
  }

  // ========== Flexible Subscribe/Redeem (90-day windows) ==========
  console.log('\n--- Flexible Earn Subscribe/Redeem ---');
  extraSources.flexibleOps = [];
  for (const opType of ['SUBSCRIPTION', 'REDEMPTION'] as const) {
    wEnd = now;
    while (wEnd > earliest) {
      const wStart = Math.max(wEnd - NINETY_DAYS, earliest);
      const endpoint = opType === 'SUBSCRIPTION' ? 'getFlexibleSubscriptionRecord' : 'getFlexibleRedemptionRecord';
      try {
        let page = 1;
        while (true) {
          const resp = await (client as any)[endpoint]?.({
            startTime: wStart, endTime: wEnd, size: 100, current: page,
          });
          const rows = (resp as any)?.rows ?? [];
          if (!Array.isArray(rows) || rows.length === 0) break;
          for (const r of rows) r._opType = opType;
          extraSources.flexibleOps.push(...rows);
          if (rows.length < 100) break;
          page++;
          await delay(200);
        }
      } catch { /* skip */ }
      wEnd = wStart;
      await delay(100);
    }
  }
  console.log(`  Flexible operations: ${extraSources.flexibleOps.length}`);
  for (const f of extraSources.flexibleOps.slice(0, 20)) {
    console.log(`    ${f._opType} ${f.asset ?? f.productId ?? '?'} ${f.amount ?? '?'}`);
  }

  // ========== Fiat Orders (already found 5) ==========
  extraSources.fiatOrders = [];
  for (const tt of ['0', '1']) {
    try {
      let page = 1;
      while (true) {
        const resp = await (client as any).getFiatOrderHistory?.({ transactionType: tt, page, rows: 500 });
        const data = (resp as any)?.data ?? [];
        if (!Array.isArray(data) || data.length === 0) break;
        for (const d of data) d._type = tt === '0' ? 'DEPOSIT' : 'WITHDRAW';
        extraSources.fiatOrders.push(...data);
        if (data.length < 500) break;
        page++;
        await delay(200);
      }
    } catch { /* skip */ }
  }

  writeJson('extra-sources.json', extraSources);

  // ========== FULL BALANCE RECONSTRUCTION ==========
  console.log('\n' + '='.repeat(60));
  console.log('  FULL BALANCE RECONSTRUCTION');
  console.log('='.repeat(60));

  const balances: Record<string, {
    net: number;
    details: Record<string, number>;
  }> = {};

  function track(asset: string, amount: number, source: string) {
    if (!asset || Math.abs(amount) < 1e-12) return;
    const a = asset.toUpperCase();
    if (!balances[a]) balances[a] = { net: 0, details: {} };
    balances[a].net += amount;
    balances[a].details[source] = (balances[a].details[source] ?? 0) + amount;
  }

  // From original API data
  const knownQuotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'BNB', 'BRL', 'EUR', 'USD', 'TRY'];
  function parseSymbol(symbol: string): { base: string; quote: string } {
    for (const q of knownQuotes) { if (symbol.endsWith(q)) return { base: symbol.slice(0, -q.length), quote: q }; }
    return { base: symbol.slice(0, -4), quote: symbol.slice(-4) };
  }

  // Deposits
  for (const d of apiData.deposits) track(d.coin, parseFloat(d.amount), 'DEPOSIT');
  // Withdrawals
  for (const w of apiData.withdrawals) {
    track(w.coin, -parseFloat(w.amount), 'WITHDRAWAL');
    if (parseFloat(w.transactionFee) > 0) track(w.coin, -parseFloat(w.transactionFee), 'WITHDRAWAL_FEE');
  }
  // Trades
  for (const t of apiData.trades) {
    const { base, quote } = parseSymbol((t as any)._symbol ?? '');
    const qty = parseFloat(t.qty);
    const quoteQty = parseFloat(t.quoteQty);
    if (t.isBuyer) { track(base, qty, 'TRADE_BUY'); track(quote, -quoteQty, 'TRADE_BUY'); }
    else { track(base, -qty, 'TRADE_SELL'); track(quote, quoteQty, 'TRADE_SELL'); }
    if (parseFloat(t.commission) > 0) track(t.commissionAsset, -parseFloat(t.commission), 'TRADE_FEE');
  }
  // Converts
  for (const c of apiData.converts) {
    track(c.fromAsset, -parseFloat(c.fromAmount), 'CONVERT_OUT');
    track(c.toAsset, parseFloat(c.toAmount), 'CONVERT_IN');
  }

  // === NEW SOURCES ===
  // Fiat orders
  for (const f of extraSources.fiatOrders) {
    if (f.status !== 'Successful') continue;
    if (f._type === 'DEPOSIT') track(f.fiatCurrency, parseFloat(f.amount), 'FIAT_DEPOSIT');
    else track(f.fiatCurrency, -parseFloat(f.amount), 'FIAT_WITHDRAW');
  }

  // Universal transfers
  for (const t of extraSources.universalTransfers) {
    const isIn = t._transferType?.endsWith('_MAIN');
    track(t.asset, parseFloat(t.amount) * (isIn ? 1 : -1), `TRANSFER_${t._transferType}`);
  }

  // Dividends (IN)
  for (const d of extraSources.dividends) {
    track(d.asset ?? d.enInfo?.asset, parseFloat(d.amount ?? '0'), 'DIVIDEND');
  }

  // Earn rewards (IN)
  for (const r of extraSources.earnRewards) {
    const a = r.asset ?? r.rewards?.[0]?.asset;
    const amt = parseFloat(r.amount ?? r.rewards?.[0]?.amount ?? '0');
    track(a, amt, `EARN_REWARD_${r._rewardType}`);
  }

  // Flexible subscribe = OUT from spot, redeem = IN to spot
  for (const f of extraSources.flexibleOps) {
    const amt = parseFloat(f.amount ?? '0');
    if (f._opType === 'SUBSCRIPTION') track(f.asset, -amt, 'EARN_SUBSCRIBE');
    else track(f.asset, amt, 'EARN_REDEEM');
  }

  // Load real balances
  let realBalances: Record<string, any> = {};
  try {
    realBalances = JSON.parse(readFileSync(join(OUTPUT_DIR, 'real-balances.json'), 'utf8'));
  } catch { /* skip */ }

  // Print comparison table
  const allAssets = new Set([...Object.keys(balances), ...Object.keys(realBalances)]);
  const report: string[] = [];
  report.push('='.repeat(110));
  report.push('  FULL BALANCE COMPARISON (with all discovered sources)');
  report.push('='.repeat(110));
  report.push(`  Generated: ${new Date().toISOString()}`);
  report.push('');
  report.push(
    '  ' + 'ASSET'.padEnd(8) + 'REAL'.padStart(16) + 'RECONSTRUCTED'.padStart(16) + 'DIFF'.padStart(16) + 'STATUS'.padStart(10)
  );
  report.push('  ' + '-'.repeat(66));

  const rows: any[] = [];
  for (const asset of [...allAssets].sort()) {
    const real = realBalances[asset]?.total ?? 0;
    const recon = balances[asset]?.net ?? 0;
    const diff = recon - real;
    if (Math.abs(real) < 1e-8 && Math.abs(recon) < 1e-8) continue;

    const status = Math.abs(diff) < 0.01 ? 'OK' : 'MISMATCH';
    rows.push({ asset, real, recon, diff, status, details: balances[asset]?.details ?? {} });

    report.push(
      '  ' + asset.padEnd(8) +
      real.toFixed(8).padStart(16) +
      recon.toFixed(8).padStart(16) +
      (diff >= 0 ? '+' : '') + diff.toFixed(8).padStart(15) +
      status.padStart(10)
    );
  }

  report.push('');
  for (const row of rows) {
    if (row.status === 'OK') continue;
    report.push(`  --- ${row.asset} --- (diff: ${row.diff.toFixed(8)})`);
    for (const [source, amount] of Object.entries(row.details).sort((a, b) => Math.abs(b[1] as number) - Math.abs(a[1] as number))) {
      report.push(`    ${source.padEnd(25)} ${(amount as number) >= 0 ? '+' : ''}${(amount as number).toFixed(8)}`);
    }
    report.push('');
  }

  const reportTxt = report.join('\n');
  console.log('\n' + reportTxt);
  writeTxt('full-report.txt', reportTxt);
  writeJson('full-comparison.json', rows);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
