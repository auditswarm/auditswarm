/**
 * OKX API Endpoint Explorer — Raw data inspection.
 *
 * Explores ALL OKX V5 API endpoints to find where trades, conversions,
 * and fiat flows (BRL) actually live. Dumps raw responses.
 *
 * This script does NOT save to DB. It only reads from OKX API and prints.
 *
 * Usage:
 *   cd auditswarm/backend
 *   NODE_PATH=libs/database/node_modules:node_modules:apps/api/node_modules npx tsx scripts/okx-explore-endpoints.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

import { PrismaClient } from '@prisma/client';
import { createDecipheriv } from 'crypto';
import { RestClient } from 'okx-api';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const OUTPUT_DIR = join(__dirname, 'audit-output');
mkdirSync(OUTPUT_DIR, { recursive: true });

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

async function main() {
  console.log('='.repeat(70));
  console.log('  OKX API Endpoint Explorer');
  console.log('='.repeat(70));

  const ENCRYPTION_KEY = process.env.EXCHANGE_ENCRYPTION_KEY!;
  const conn = await prisma.exchangeConnection.findFirst({ where: { exchangeName: 'okx' } });
  if (!conn) { console.error('No OKX connection'); process.exit(1); }

  const apiKey = decrypt(conn.encryptedApiKey, ENCRYPTION_KEY);
  const apiSecret = decrypt(conn.encryptedApiSecret, ENCRYPTION_KEY);
  const passphrase = conn.encryptedPassphrase ? decrypt(conn.encryptedPassphrase, ENCRYPTION_KEY) : '';
  const client = new RestClient({ apiKey, apiSecret, apiPass: passphrase });

  const results: Record<string, any> = {};

  // ===== 1. Account Config =====
  console.log('\n--- 1. Account Configuration ---');
  try {
    const config = await client.getAccountConfiguration();
    console.log('  Config:', JSON.stringify(config?.[0], null, 2).slice(0, 500));
    results.accountConfig = config;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 2. Deposit History (raw) =====
  console.log('\n--- 2. Deposit History (first page) ---');
  try {
    const deposits = await client.getDepositHistory({ limit: '10' } as any);
    console.log(`  ${(deposits as any[])?.length ?? 0} deposits returned`);
    if (deposits && (deposits as any[]).length > 0) {
      console.log('  Sample:', JSON.stringify(deposits[0], null, 2));
      // Check for any BRL-related
      const brl = (deposits as any[]).filter((d: any) => d.ccy === 'BRL' || (d.chain ?? '').includes('BRL'));
      console.log(`  BRL deposits: ${brl.length}`);
    }
    results.deposits = deposits;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 3. Withdrawal History (raw) =====
  console.log('\n--- 3. Withdrawal History (first page) ---');
  try {
    const withdrawals = await client.getWithdrawalHistory({ limit: '10' } as any);
    console.log(`  ${(withdrawals as any[])?.length ?? 0} withdrawals returned`);
    if (withdrawals && (withdrawals as any[]).length > 0) {
      console.log('  Sample:', JSON.stringify(withdrawals[0], null, 2));
      const brl = (withdrawals as any[]).filter((w: any) => w.ccy === 'BRL' || (w.chain ?? '').includes('BRL'));
      console.log(`  BRL withdrawals: ${brl.length}`);
    }
    results.withdrawals = withdrawals;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 4. Spot Fills (trades last 3 months) =====
  console.log('\n--- 4. Spot Fills History (SPOT trades) ---');
  try {
    const fills = await client.getFillsHistory({ instType: 'SPOT', limit: '100' } as any);
    console.log(`  ${fills?.length ?? 0} spot fills returned`);
    if (fills && fills.length > 0) {
      console.log('  Sample:', JSON.stringify(fills[0], null, 2));
      // Check for BRL pairs
      const brlFills = fills.filter(f => f.instId?.includes('BRL'));
      console.log(`  BRL-pair fills: ${brlFills.length}`);
      if (brlFills.length > 0) {
        console.log('  BRL fill sample:', JSON.stringify(brlFills[0], null, 2));
      }
      // Show all unique instIds
      const instIds = [...new Set(fills.map(f => f.instId))];
      console.log(`  Unique instruments: ${instIds.join(', ')}`);
    }
    results.spotFills = fills;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 5. Recent Fills (last 3 days, all types) =====
  console.log('\n--- 5. Recent Fills (getFills, last 3 days) ---');
  try {
    const recentFills = await (client as any).getFills({ limit: '100' });
    const list = Array.isArray(recentFills) ? recentFills : [];
    console.log(`  ${list.length} recent fills returned`);
    if (list.length > 0) {
      console.log('  Sample:', JSON.stringify(list[0], null, 2));
      const instIds = [...new Set(list.map((f: any) => f.instId))];
      console.log(`  Unique instruments: ${instIds.join(', ')}`);
    }
    results.recentFills = list;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 6. Convert History =====
  console.log('\n--- 6. Convert History ---');
  try {
    const convert = await client.getConvertHistory({ limit: '100' } as any);
    const list = Array.isArray(convert) ? convert : [];
    console.log(`  ${list.length} convert records returned`);
    if (list.length > 0) {
      console.log('  Sample:', JSON.stringify(list[0], null, 2));
      const brl = list.filter((c: any) =>
        (c.baseCcy ?? c.fromCcy ?? '').includes('BRL') ||
        (c.quoteCcy ?? c.toCcy ?? '').includes('BRL')
      );
      console.log(`  BRL converts: ${brl.length}`);
      if (brl.length > 0) console.log('  BRL sample:', JSON.stringify(brl[0], null, 2));
    }
    results.convertHistory = list;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 7. Easy Convert History (dust) =====
  console.log('\n--- 7. Easy Convert History (dust) ---');
  try {
    const dust = await client.getEasyConvertHistory({ limit: '100' } as any);
    const list = Array.isArray(dust) ? dust : (dust as any)?.data ?? [];
    console.log(`  ${list.length} easy convert records returned`);
    if (list.length > 0) {
      console.log('  Sample:', JSON.stringify(list[0], null, 2));
    }
    results.easyConvertHistory = list;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 8. Account Bills (last 7 days - all types, universal ledger) =====
  console.log('\n--- 8. Account Bills (getBills, last 7 days) ---');
  try {
    const bills = await (client as any).getBills({ limit: '100' });
    const list = Array.isArray(bills) ? bills : [];
    console.log(`  ${list.length} bills returned`);
    if (list.length > 0) {
      console.log('  Sample:', JSON.stringify(list[0], null, 2));
      // Show unique types/subTypes
      const types = [...new Set(list.map((b: any) => `type=${b.type} subType=${b.subType}`))];
      console.log(`  Unique bill types: ${types.join(' | ')}`);
      // Check for BRL
      const brl = list.filter((b: any) => (b.ccy ?? '').includes('BRL'));
      console.log(`  BRL bills: ${brl.length}`);
      if (brl.length > 0) console.log('  BRL bill sample:', JSON.stringify(brl[0], null, 2));
    }
    results.bills = list;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 9. Account Bills Archive (getBillsArchive, older history) =====
  console.log('\n--- 9. Account Bills Archive (last 3 months) ---');
  try {
    const billsArch = await client.getBillsArchive({ limit: '100' } as any);
    const list = Array.isArray(billsArch) ? billsArch : [];
    console.log(`  ${list.length} archived bills returned`);
    if (list.length > 0) {
      console.log('  Sample:', JSON.stringify(list[0], null, 2));
      const types = [...new Set(list.map((b: any) => `type=${b.type} subType=${b.subType}`))];
      console.log(`  Unique bill types: ${types.join(' | ')}`);
    }
    results.billsArchive = list;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 10. Fiat Deposit/Withdrawal Methods =====
  console.log('\n--- 10. Fiat Deposit Methods ---');
  try {
    const fiatDeposit = await (client as any).getFiatDepositPaymentMethods?.({ ccy: 'BRL' });
    console.log('  BRL deposit methods:', JSON.stringify(fiatDeposit, null, 2)?.slice(0, 500));
    results.fiatDepositMethods = fiatDeposit;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  console.log('\n--- 11. Fiat Withdrawal Methods ---');
  try {
    const fiatWithdraw = await (client as any).getFiatWithdrawPaymentMethods?.({ ccy: 'BRL' });
    console.log('  BRL withdraw methods:', JSON.stringify(fiatWithdraw, null, 2)?.slice(0, 500));
    results.fiatWithdrawMethods = fiatWithdraw;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 12. Fiat Deposit History =====
  console.log('\n--- 12. Fiat Deposit History ---');
  try {
    const fiatDeposits = await (client as any).getFiatDepositHistory?.({ ccy: 'BRL' });
    const list = Array.isArray(fiatDeposits) ? fiatDeposits : fiatDeposits?.data ?? [];
    console.log(`  ${list.length ?? 0} fiat deposit records`);
    if (list.length > 0) {
      console.log('  Sample:', JSON.stringify(list[0], null, 2));
    }
    results.fiatDeposits = list;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 13. Fiat Withdrawal History =====
  console.log('\n--- 13. Fiat Withdrawal History ---');
  try {
    const fiatWithdrawals = await (client as any).getFiatWithdrawalHistory?.({ ccy: 'BRL' });
    const list = Array.isArray(fiatWithdrawals) ? fiatWithdrawals : fiatWithdrawals?.data ?? [];
    console.log(`  ${list.length ?? 0} fiat withdrawal records`);
    if (list.length > 0) {
      console.log('  Sample:', JSON.stringify(list[0], null, 2));
    }
    results.fiatWithdrawals = list;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 14. Asset Currencies (check which currencies are available) =====
  console.log('\n--- 14. Available Currencies ---');
  try {
    const currencies = await client.getCurrencies();
    const ccyList = Array.isArray(currencies) ? currencies : [];
    // Check for BRL
    const brl = ccyList.filter((c: any) => (c.ccy ?? '').includes('BRL'));
    console.log(`  Total currencies: ${ccyList.length}`);
    console.log(`  BRL entries: ${brl.length}`);
    if (brl.length > 0) {
      console.log('  BRL currency info:', JSON.stringify(brl[0], null, 2));
    }
    // Also check for fiat currencies
    const fiat = ccyList.filter((c: any) =>
      ['BRL', 'USD', 'EUR', 'GBP', 'JPY', 'ARS', 'TRY'].includes(c.ccy)
    );
    console.log(`  Known fiat currencies found: ${fiat.map((c: any) => c.ccy).join(', ') || 'none'}`);
    results.currencies = { total: ccyList.length, brl, fiat };
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 15. Trading Pairs with BRL =====
  console.log('\n--- 15. Trading Pairs with BRL ---');
  try {
    const instruments = await client.getInstruments({ instType: 'SPOT' });
    const allPairs = Array.isArray(instruments) ? instruments : [];
    const brlPairs = allPairs.filter((i: any) =>
      (i.instId ?? '').includes('BRL') ||
      (i.baseCcy ?? '').includes('BRL') ||
      (i.quoteCcy ?? '').includes('BRL')
    );
    console.log(`  Total SPOT instruments: ${allPairs.length}`);
    console.log(`  BRL pairs: ${brlPairs.length}`);
    for (const p of brlPairs) {
      console.log(`    ${(p as any).instId} — base: ${(p as any).baseCcy}, quote: ${(p as any).quoteCcy}, state: ${(p as any).state}`);
    }
    results.brlPairs = brlPairs;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 16. Trade Orders History (for BRL pairs) =====
  console.log('\n--- 16. Trade Order History ---');
  try {
    // Try fetching order history (covers all filled orders, not just fills)
    const orders = await (client as any).getOrderHistory({ instType: 'SPOT', limit: '100' });
    const list = Array.isArray(orders) ? orders : [];
    console.log(`  ${list.length} order history records`);
    if (list.length > 0) {
      console.log('  Sample:', JSON.stringify(list[0], null, 2));
      const brlOrders = list.filter((o: any) => (o.instId ?? '').includes('BRL'));
      console.log(`  BRL orders: ${brlOrders.length}`);
      if (brlOrders.length > 0) {
        console.log('  BRL order sample:', JSON.stringify(brlOrders[0], null, 2));
      }
      const instIds = [...new Set(list.map((o: any) => o.instId))];
      console.log(`  Unique instruments: ${instIds.join(', ')}`);
    }
    results.orderHistory = list;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 17. Trade Order History Archive (older than 7 days) =====
  console.log('\n--- 17. Trade Order History Archive ---');
  try {
    const archOrders = await (client as any).getOrderHistoryArchive({ instType: 'SPOT', limit: '100' });
    const list = Array.isArray(archOrders) ? archOrders : [];
    console.log(`  ${list.length} archived order records`);
    if (list.length > 0) {
      console.log('  Sample:', JSON.stringify(list[0], null, 2));
      const brlOrders = list.filter((o: any) => (o.instId ?? '').includes('BRL'));
      console.log(`  BRL orders: ${brlOrders.length}`);
      if (brlOrders.length > 0) {
        console.log('  BRL order sample:', JSON.stringify(brlOrders[0], null, 2));
      }
      const instIds = [...new Set(list.map((o: any) => o.instId))];
      console.log(`  Unique instruments: ${instIds.join(', ')}`);
    }
    results.orderHistoryArchive = list;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 18. Funding transfer history (internal transfers) =====
  console.log('\n--- 18. Asset Transfer State History ---');
  try {
    const transfers = await (client as any).getAssetTransferState?.({ limit: '20' });
    const list = Array.isArray(transfers) ? transfers : [];
    console.log(`  ${list.length} transfer records`);
    if (list.length > 0) console.log('  Sample:', JSON.stringify(list[0], null, 2));
    results.transferHistory = list;
  } catch (e: any) { console.log('  ERROR:', e.message); }
  await delay(200);

  // ===== 19. Balances (all accounts) =====
  console.log('\n--- 19. All Balances ---');
  try {
    // Trading
    const tradBal = await client.getBalance();
    const tradDetails = tradBal?.[0]?.details?.filter(d =>
      parseFloat(d.eq ?? '0') > 0.000001
    ) ?? [];
    console.log(`  Trading: ${tradDetails.length} assets with balance`);
    for (const d of tradDetails) {
      console.log(`    ${d.ccy}: eq=${d.eq} avail=${d.availBal} frozen=${d.frozenBal}`);
    }

    // Funding
    const fundBal = await client.getBalances();
    const fundNonZero = fundBal.filter(f =>
      parseFloat(f.availBal ?? '0') > 0.000001 || parseFloat(f.frozenBal ?? '0') > 0.000001
    );
    console.log(`  Funding: ${fundNonZero.length} assets with balance`);
    for (const f of fundNonZero) {
      console.log(`    ${f.ccy}: avail=${f.availBal} frozen=${f.frozenBal}`);
    }
  } catch (e: any) { console.log('  ERROR:', e.message); }

  // ===== 20. P2P / C2C attempts =====
  console.log('\n--- 20. P2P/C2C Endpoints (exploratory) ---');
  const p2pMethods = [
    'getC2COrderHistory', 'getP2POrderHistory', 'getP2POrders', 'getC2COrders',
    'getFiatPaymentHistory', 'getC2CHistory', 'getOtcHistory',
  ];
  for (const method of p2pMethods) {
    try {
      const fn = (client as any)[method];
      if (typeof fn !== 'function') {
        console.log(`  ${method}: NOT AVAILABLE in SDK`);
        continue;
      }
      const result = await fn.call(client, { limit: '10' });
      const list = Array.isArray(result) ? result : result?.data ?? [];
      console.log(`  ${method}: ${list.length} records`);
      if (list.length > 0) console.log('    Sample:', JSON.stringify(list[0], null, 2).slice(0, 300));
    } catch (e: any) {
      console.log(`  ${method}: ${e.message?.slice(0, 100)}`);
    }
    await delay(200);
  }

  // ===== 21. Direct REST call to fiat endpoints =====
  console.log('\n--- 21. Direct REST Fiat Endpoints ---');
  const fiatEndpoints = [
    { path: '/api/v5/fiat/deposit-history', params: {} },
    { path: '/api/v5/fiat/withdrawal-history', params: {} },
    { path: '/api/v5/fiat/payments', params: {} },
    { path: '/api/v5/fiat/channel', params: { ccy: 'BRL' } },
  ];
  for (const ep of fiatEndpoints) {
    try {
      const result = await (client as any).getPrivate?.(ep.path, ep.params) ??
                     await (client as any).get?.(ep.path, ep.params);
      const data = result?.data ?? result;
      const list = Array.isArray(data) ? data : [];
      console.log(`  ${ep.path}: ${list.length} records`);
      if (list.length > 0) console.log('    Sample:', JSON.stringify(list[0], null, 2).slice(0, 300));
    } catch (e: any) {
      console.log(`  ${ep.path}: ${e.message?.slice(0, 120)}`);
    }
    await delay(200);
  }

  // Write everything
  writeFileSync(
    join(OUTPUT_DIR, 'okx-raw-endpoints.json'),
    JSON.stringify(results, null, 2),
  );
  console.log(`\n  Full results written to audit-output/okx-raw-endpoints.json`);

  console.log('\n' + '='.repeat(70));
  console.log('  Explorer Complete');
  console.log('='.repeat(70));

  await prisma.$disconnect();
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
