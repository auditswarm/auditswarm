/**
 * Binance Missing Sources Discovery
 *
 * The audit showed DB/API match but both miss funds. This script probes
 * ALL Binance API endpoints to find the missing transaction sources:
 * - Universal transfers (spot ↔ futures ↔ margin ↔ earn)
 * - Binance Pay history
 * - Auto-invest history
 * - Savings/Earn interest distributions
 * - Referral/commission history
 * - Gift card history
 * - Distribution history (airdrops, hardforks)
 * - Fiat orders with different parameters
 *
 * Usage:
 *   cd auditswarm/backend
 *   NODE_PATH=libs/database/node_modules npx tsx scripts/binance-missing-sources.ts
 */

import { PrismaClient } from '@prisma/client';
import { createDecipheriv } from 'crypto';
import { MainClient } from 'binance';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const OUTPUT_DIR = join(__dirname, 'audit-output');
mkdirSync(OUTPUT_DIR, { recursive: true });

function writeJson(name: string, data: any) {
  writeFileSync(join(OUTPUT_DIR, name), JSON.stringify(data, null, 2));
  console.log(`  Wrote ${name}`);
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

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  Binance Missing Sources Discovery');
  console.log('='.repeat(60));

  const ENCRYPTION_KEY = process.env.EXCHANGE_ENCRYPTION_KEY ?? 'ef6b7e0342cd23ed007cb51aaecf447ef6a6138c882b0de9931c719967f11955';
  const connection = await prisma.exchangeConnection.findFirst({ where: { exchangeName: 'binance', status: 'ACTIVE' } });
  if (!connection) { console.error('No connection'); process.exit(1); }
  const apiKey = decrypt(connection.encryptedApiKey, ENCRYPTION_KEY);
  const apiSecret = decrypt(connection.encryptedApiSecret, ENCRYPTION_KEY);
  const client = new MainClient({ api_key: apiKey, api_secret: apiSecret });

  const now = Date.now();
  const earliest = now - ONE_YEAR_MS;
  const results: Record<string, any> = {};

  // ========== 1. Universal Transfer History ==========
  // Transfers between wallets (MAIN ↔ UMFUTURE ↔ MARGIN ↔ MINING ↔ FUNDING ↔ etc)
  console.log('\n--- 1. Universal Transfer History ---');
  const transferTypes = [
    'MAIN_UMFUTURE', 'UMFUTURE_MAIN',
    'MAIN_MARGIN', 'MARGIN_MAIN',
    'MAIN_FUNDING', 'FUNDING_MAIN',
    'MAIN_C2C', 'C2C_MAIN',
    'MAIN_CMFUTURE', 'CMFUTURE_MAIN',
    'MARGIN_UMFUTURE', 'UMFUTURE_MARGIN',
    'MAIN_ISOLATEDMARGIN', 'ISOLATEDMARGIN_MAIN',
    'MAIN_OPTION', 'OPTION_MAIN',
    'FUNDING_UMFUTURE', 'UMFUTURE_FUNDING',
    'MAIN_PORTFOLIO_MARGIN', 'PORTFOLIO_MARGIN_MAIN',
  ];

  results.universalTransfers = {};
  for (const type of transferTypes) {
    try {
      const resp = await (client as any).getUniversalTransferHistory?.({ type, startTime: earliest, endTime: now, size: 100 });
      const rows = (resp as any)?.rows ?? resp ?? [];
      if (Array.isArray(rows) && rows.length > 0) {
        results.universalTransfers[type] = rows;
        console.log(`  ${type}: ${rows.length} transfers`);
      }
    } catch (e: any) {
      if (!e.message?.includes('not found') && !e.message?.includes('not exist')) {
        console.log(`  ${type}: ${e.message?.slice(0, 60)}`);
      }
    }
    await delay(100);
  }
  console.log(`  Total transfer types with data: ${Object.keys(results.universalTransfers).length}`);

  // ========== 2. getUserAsset (full wallet snapshot) ==========
  console.log('\n--- 2. User Asset (snapshot with all wallets) ---');
  try {
    const assets = await (client as any).getUserAsset?.({});
    results.userAssets = assets;
    if (Array.isArray(assets)) {
      const nonZero = assets.filter((a: any) =>
        parseFloat(a.free) > 0 || parseFloat(a.locked) > 0 || parseFloat(a.freeze) > 0 || parseFloat(a.withdrawing) > 0
      );
      console.log(`  Assets: ${assets.length} total, ${nonZero.length} with balance`);
      for (const a of nonZero) {
        console.log(`    ${a.asset}: free=${a.free} locked=${a.locked} freeze=${a.freeze} withdrawing=${a.withdrawing}`);
      }
    } else {
      console.log(`  Response: ${JSON.stringify(assets)?.slice(0, 200)}`);
    }
  } catch (e: any) { console.log(`  Error: ${e.message?.slice(0, 80)}`); }

  // ========== 3. Asset Dividend History (distributions, airdrops) ==========
  console.log('\n--- 3. Asset Dividend History (airdrops, hardforks, distributions) ---');
  results.dividends = [];
  try {
    let page = 0;
    while (true) {
      const resp = await (client as any).getAssetDividendRecord?.({ startTime: earliest, endTime: now, limit: 500, offset: page * 500 });
      const rows = (resp as any)?.rows ?? resp ?? [];
      if (!Array.isArray(rows) || rows.length === 0) break;
      results.dividends.push(...rows);
      if (rows.length < 500) break;
      page++;
      await delay(200);
    }
    console.log(`  Dividends: ${results.dividends.length}`);
    // Group by asset
    const byAsset: Record<string, { count: number; total: number }> = {};
    for (const d of results.dividends) {
      const asset = d.asset ?? d.enInfo?.asset ?? 'UNKNOWN';
      if (!byAsset[asset]) byAsset[asset] = { count: 0, total: 0 };
      byAsset[asset].count++;
      byAsset[asset].total += parseFloat(d.amount ?? '0');
    }
    for (const [asset, info] of Object.entries(byAsset)) {
      console.log(`    ${asset}: ${info.count} dividends, total ${info.total.toFixed(8)}`);
    }
  } catch (e: any) { console.log(`  Error: ${e.message?.slice(0, 80)}`); }

  // ========== 4. Binance Pay History ==========
  console.log('\n--- 4. Binance Pay History ---');
  try {
    const pay = await (client as any).getPayTradeHistory?.({ startTime: earliest, endTime: now });
    results.payHistory = pay;
    const data = (pay as any)?.data ?? pay ?? [];
    console.log(`  Pay transactions: ${Array.isArray(data) ? data.length : JSON.stringify(data)?.slice(0, 100)}`);
  } catch (e: any) { console.log(`  Error: ${e.message?.slice(0, 80)}`); }

  // ========== 5. Simple Earn Flexible History (rewards) ==========
  console.log('\n--- 5. Simple Earn Rewards History ---');
  results.earnRewards = [];
  try {
    // Flexible rewards
    let page = 1;
    while (true) {
      const resp = await (client as any).getFlexibleRewardsHistory?.({
        type: 'BONUS',
        startTime: earliest,
        endTime: now,
        size: 100,
        current: page,
      });
      const rows = (resp as any)?.rows ?? resp ?? [];
      if (!Array.isArray(rows) || rows.length === 0) break;
      results.earnRewards.push(...rows.map((r: any) => ({ ...r, _earnType: 'FLEXIBLE_BONUS' })));
      if (rows.length < 100) break;
      page++;
      await delay(200);
    }
  } catch (e: any) { console.log(`  Flexible bonus: ${e.message?.slice(0, 60)}`); }

  try {
    let page = 1;
    while (true) {
      const resp = await (client as any).getFlexibleRewardsHistory?.({
        type: 'REALTIME',
        startTime: earliest,
        endTime: now,
        size: 100,
        current: page,
      });
      const rows = (resp as any)?.rows ?? resp ?? [];
      if (!Array.isArray(rows) || rows.length === 0) break;
      results.earnRewards.push(...rows.map((r: any) => ({ ...r, _earnType: 'FLEXIBLE_REALTIME' })));
      if (rows.length < 100) break;
      page++;
      await delay(200);
    }
  } catch (e: any) { console.log(`  Flexible realtime: ${e.message?.slice(0, 60)}`); }

  // Locked rewards
  try {
    let page = 1;
    while (true) {
      const resp = await (client as any).getLockedRewardsHistory?.({
        startTime: earliest,
        endTime: now,
        size: 100,
        current: page,
      });
      const rows = (resp as any)?.rows ?? resp ?? [];
      if (!Array.isArray(rows) || rows.length === 0) break;
      results.earnRewards.push(...rows.map((r: any) => ({ ...r, _earnType: 'LOCKED' })));
      if (rows.length < 100) break;
      page++;
      await delay(200);
    }
  } catch (e: any) { console.log(`  Locked rewards: ${e.message?.slice(0, 60)}`); }
  console.log(`  Total earn rewards: ${results.earnRewards.length}`);

  // ========== 6. Fiat Order History (different from fiat payments) ==========
  console.log('\n--- 6. Fiat Order History ---');
  results.fiatOrders = [];
  for (const transactionType of ['0', '1']) {
    try {
      let page = 1;
      while (true) {
        const resp = await (client as any).getFiatOrderHistory?.({
          transactionType,
          page,
          rows: 500,
          beginTime: earliest,
          endTime: now,
        });
        const data = (resp as any)?.data ?? resp ?? [];
        if (!Array.isArray(data) || data.length === 0) break;
        results.fiatOrders.push(...data.map((d: any) => ({ ...d, _type: transactionType === '0' ? 'DEPOSIT' : 'WITHDRAW' })));
        if (data.length < 500) break;
        page++;
        await delay(200);
      }
    } catch (e: any) { console.log(`  Fiat orders type ${transactionType}: ${e.message?.slice(0, 60)}`); }
  }
  console.log(`  Fiat orders: ${results.fiatOrders.length}`);
  for (const f of results.fiatOrders) {
    console.log(`    ${f._type} ${f.fiatCurrency ?? '?'} ${f.amount ?? '?'} status=${f.status ?? '?'} @ ${f.createTime ?? '?'}`);
  }

  // ========== 7. Fiat Payments History (buy/sell) ==========
  console.log('\n--- 7. Fiat Payments History ---');
  results.fiatPayments = [];
  for (const transactionType of ['0', '1']) {
    try {
      let page = 1;
      while (true) {
        const resp = await client.getFiatPaymentsHistory({
          transactionType: transactionType as any,
          page,
          rows: 500,
          beginTime: earliest,
          endTime: now,
        } as any);
        const data = (resp as any)?.data ?? resp ?? [];
        if (!Array.isArray(data) || data.length === 0) break;
        results.fiatPayments.push(...data.map((d: any) => ({ ...d, _type: transactionType === '0' ? 'BUY' : 'SELL' })));
        if (data.length < 500) break;
        page++;
        await delay(200);
      }
    } catch (e: any) { console.log(`  Fiat payments type ${transactionType}: ${e.message?.slice(0, 60)}`); }
  }
  console.log(`  Fiat payments: ${results.fiatPayments.length}`);
  for (const f of results.fiatPayments) {
    console.log(`    ${f._type} ${f.fiatCurrency ?? '?'} ${f.sourceAmount ?? f.totalAmount ?? '?'} status=${f.status ?? '?'}`);
  }

  // ========== 8. C2C (P2P) Trade History ==========
  console.log('\n--- 8. C2C (P2P) Trade History ---');
  results.c2cTrades = [];
  for (const tradeType of ['BUY', 'SELL'] as const) {
    try {
      let page = 1;
      while (true) {
        const resp = await (client as any).getC2CTradeHistory?.({ tradeType, page, rows: 100 });
        const data = (resp as any)?.data ?? resp ?? [];
        if (!Array.isArray(data) || data.length === 0) break;
        results.c2cTrades.push(...data.map((d: any) => ({ ...d, _tradeType: tradeType })));
        if (data.length < 100) break;
        page++;
        await delay(200);
      }
    } catch (e: any) { console.log(`  C2C ${tradeType}: ${e.message?.slice(0, 60)}`); }
  }
  console.log(`  C2C trades: ${results.c2cTrades.length}`);

  // ========== 9. Sub-account transfers ==========
  console.log('\n--- 9. Sub-account Transfers ---');
  try {
    const resp = await (client as any).getSubAccountTransferHistory?.({ startTime: earliest, endTime: now, limit: 500 });
    results.subAccountTransfers = resp;
    const data = Array.isArray(resp) ? resp : (resp as any)?.result ?? [];
    console.log(`  Sub-account transfers: ${Array.isArray(data) ? data.length : JSON.stringify(data)?.slice(0, 100)}`);
  } catch (e: any) { console.log(`  Error: ${e.message?.slice(0, 80)}`); }

  // ========== 10. Auto-Invest History ==========
  console.log('\n--- 10. Auto-Invest History ---');
  try {
    const resp = await (client as any).getAutoInvestHistory?.({ size: 100 });
    results.autoInvest = resp;
    console.log(`  Auto-invest: ${JSON.stringify(resp)?.slice(0, 200)}`);
  } catch (e: any) { console.log(`  Error: ${e.message?.slice(0, 80)}`); }

  // ========== 11. Gift Card History ==========
  console.log('\n--- 11. Gift Card History ---');
  try {
    const resp = await (client as any).getGiftCardHistory?.();
    results.giftCards = resp;
    console.log(`  Gift cards: ${JSON.stringify(resp)?.slice(0, 200)}`);
  } catch (e: any) { console.log(`  Error: ${e.message?.slice(0, 80)}`); }

  // ========== 12. Rebate/Kickback History ==========
  console.log('\n--- 12. Rebate (Spot Commission) ---');
  try {
    const resp = await (client as any).getSpotRebateHistory?.({ startTime: earliest, endTime: now, page: 1 });
    results.rebates = resp;
    const data = (resp as any)?.data?.data ?? resp ?? [];
    console.log(`  Rebates: ${Array.isArray(data) ? data.length : JSON.stringify(data)?.slice(0, 100)}`);
  } catch (e: any) { console.log(`  Error: ${e.message?.slice(0, 80)}`); }

  // ========== 13. Convert Transfer (internal) ==========
  console.log('\n--- 13. Convert Transfer History ---');
  try {
    const resp = await (client as any).getConvertTransfer?.({ startTime: earliest, endTime: now, size: 100 });
    results.convertTransfers = resp;
    console.log(`  Convert transfers: ${JSON.stringify(resp)?.slice(0, 200)}`);
  } catch (e: any) { console.log(`  Error: ${e.message?.slice(0, 80)}`); }

  // ========== 14. Flexible Product Subscription/Redemption ==========
  console.log('\n--- 14. Flexible Earn Subscribe/Redeem History ---');
  results.flexibleHistory = [];
  for (const type of ['SUBSCRIPTION', 'REDEMPTION'] as const) {
    try {
      let page = 1;
      while (true) {
        const endpoint = type === 'SUBSCRIPTION' ? 'getFlexibleSubscriptionRecord' : 'getFlexibleRedemptionRecord';
        const resp = await (client as any)[endpoint]?.({
          startTime: earliest,
          endTime: now,
          size: 100,
          current: page,
        });
        const rows = (resp as any)?.rows ?? resp ?? [];
        if (!Array.isArray(rows) || rows.length === 0) break;
        results.flexibleHistory.push(...rows.map((r: any) => ({ ...r, _type: type })));
        if (rows.length < 100) break;
        page++;
        await delay(200);
      }
    } catch (e: any) { console.log(`  Flexible ${type}: ${e.message?.slice(0, 60)}`); }
  }
  console.log(`  Flexible earn operations: ${results.flexibleHistory.length}`);
  for (const f of results.flexibleHistory.slice(0, 10)) {
    console.log(`    ${f._type} ${f.asset ?? f.productId ?? '?'} ${f.amount ?? '?'}`);
  }

  // ========== Summary ==========
  console.log('\n' + '='.repeat(60));
  console.log('  MISSING SOURCES SUMMARY');
  console.log('='.repeat(60));

  // Calculate the impact of new sources on balance reconstruction
  const newFunds: Record<string, number> = {};
  function trackNew(asset: string, amount: number, direction: 'in' | 'out') {
    if (!asset || amount === 0) return;
    const a = asset.toUpperCase();
    if (!newFunds[a]) newFunds[a] = 0;
    newFunds[a] += direction === 'in' ? amount : -amount;
  }

  // Universal transfers
  for (const [type, transfers] of Object.entries(results.universalTransfers)) {
    if (!Array.isArray(transfers)) continue;
    for (const t of transfers) {
      // MAIN_X = OUT from spot, X_MAIN = IN to spot
      const isToSpot = type.endsWith('_MAIN');
      trackNew(t.asset, parseFloat(t.amount), isToSpot ? 'in' : 'out');
    }
  }

  // Dividends
  for (const d of results.dividends ?? []) {
    trackNew(d.asset ?? d.enInfo?.asset, parseFloat(d.amount ?? '0'), 'in');
  }

  // Fiat orders
  for (const f of results.fiatOrders ?? []) {
    if (f.status === 'Successful' || f.status === 'Completed') {
      if (f._type === 'DEPOSIT') {
        trackNew(f.fiatCurrency, parseFloat(f.amount ?? '0'), 'in');
      } else {
        trackNew(f.fiatCurrency, parseFloat(f.amount ?? '0'), 'out');
      }
    }
  }

  // C2C trades
  for (const c of results.c2cTrades ?? []) {
    if (c._tradeType === 'BUY') {
      trackNew(c.asset, parseFloat(c.amount ?? '0'), 'in');
    } else {
      trackNew(c.asset, parseFloat(c.amount ?? '0'), 'out');
    }
  }

  // Earn rewards
  for (const r of results.earnRewards ?? []) {
    trackNew(r.asset ?? r.rewards?.[0]?.asset, parseFloat(r.amount ?? r.rewards?.[0]?.amount ?? '0'), 'in');
  }

  // Flexible subscribe/redeem
  for (const f of results.flexibleHistory ?? []) {
    // Subscribe = OUT from spot to earn, Redeem = IN to spot from earn
    trackNew(f.asset, parseFloat(f.amount ?? '0'), f._type === 'SUBSCRIPTION' ? 'out' : 'in');
  }

  console.log('\n  Net impact from newly discovered sources:');
  const sorted = Object.entries(newFunds).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (const [asset, amount] of sorted) {
    if (Math.abs(amount) > 0.000001) {
      console.log(`    ${asset.padEnd(8)} ${amount >= 0 ? '+' : ''}${amount.toFixed(8)}`);
    }
  }

  writeJson('missing-sources.json', results);

  console.log('\n  Files written to scripts/audit-output/');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
