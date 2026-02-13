/**
 * OKX Bills Deep Explorer — Analyzes ALL bills (the universal ledger).
 *
 * Bills capture EVERYTHING: trades, converts, transfers, fees, earn, etc.
 * This script fetches all bills and bills archive, groups by type/subType,
 * and shows which ones involve BRL or crypto↔fiat conversions.
 *
 * OKX Bill Types:
 *   1 = Transfer   (subType 11/12 = between accounts)
 *   2 = Trade       (subType 1/2 = buy/sell)
 *   3 = Delivery
 *   4 = Auto token conversion
 *   5 = Liquidation
 *   6 = Margin transfer
 *   7 = Interest deduction
 *   8 = Funding fee
 *   22 = Repay
 *   30 = Auto convert  (subType 320 = convert buy, 321 = convert sell)
 *
 * Usage:
 *   cd auditswarm/backend
 *   NODE_PATH=libs/database/node_modules:node_modules:apps/api/node_modules npx tsx scripts/okx-explore-bills.ts
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

// Bill type descriptions
const BILL_TYPES: Record<string, string> = {
  '1': 'Transfer',
  '2': 'Trade',
  '3': 'Delivery',
  '4': 'Auto token conversion',
  '5': 'Liquidation',
  '6': 'Margin transfer',
  '7': 'Interest deduction',
  '8': 'Funding fee',
  '13': 'Auto buy',
  '22': 'Repay',
  '24': 'Spread trading',
  '30': 'Convert',
};

const BILL_SUBTYPES: Record<string, string> = {
  '1': 'Buy',
  '2': 'Sell',
  '3': 'Open long',
  '4': 'Open short',
  '5': 'Close long',
  '6': 'Close short',
  '9': 'Transfer in',
  '10': 'Transfer out',
  '11': 'Transfer in (from sub-account)',
  '12': 'Transfer out (to sub-account/funding)',
  '14': 'Auto liquidation (close long)',
  '15': 'Auto liquidation (close short)',
  '100': 'Fee rebate (received)',
  '173': 'Funding fee (expense)',
  '174': 'Funding fee (income)',
  '200': 'System transfer in',
  '201': 'System transfer out',
  '320': 'Convert expense (from-asset)',
  '321': 'Convert income (to-asset)',
};

// Account names in OKX
const ACCOUNT_NAMES: Record<string, string> = {
  '1': 'Spot',
  '5': 'Futures',
  '6': 'Funding',
  '8': 'Earn',
  '12': 'Convert',
  '13': 'Auto invest',
  '18': 'Trading',
  '22': 'Cross margin',
};

async function main() {
  console.log('='.repeat(70));
  console.log('  OKX Bills Deep Explorer');
  console.log('='.repeat(70));

  const ENCRYPTION_KEY = process.env.EXCHANGE_ENCRYPTION_KEY!;
  const conn = await prisma.exchangeConnection.findFirst({ where: { exchangeName: 'okx' } });
  if (!conn) { console.error('No OKX connection'); process.exit(1); }

  const apiKey = decrypt(conn.encryptedApiKey, ENCRYPTION_KEY);
  const apiSecret = decrypt(conn.encryptedApiSecret, ENCRYPTION_KEY);
  const passphrase = conn.encryptedPassphrase ? decrypt(conn.encryptedPassphrase, ENCRYPTION_KEY) : '';
  const client = new RestClient({ apiKey, apiSecret, apiPass: passphrase });

  // ===== Fetch ALL bills (recent + archive) =====
  const allBills: any[] = [];

  // Recent bills (last 7 days)
  console.log('\n--- Fetching recent bills (getBills) ---');
  let afterId: string | undefined;
  while (true) {
    await delay(200);
    const params: any = { limit: '100' };
    if (afterId) params.after = afterId;

    const bills = await (client as any).getBills(params);
    const list = Array.isArray(bills) ? bills : [];
    if (list.length === 0) break;

    allBills.push(...list.map((b: any) => ({ ...b, _source: 'recent' })));
    console.log(`  Batch: ${list.length} bills`);

    const lastId = list[list.length - 1].billId;
    if (afterId === lastId) break;
    afterId = lastId;
    if (list.length < 100) break;
  }
  console.log(`  Total recent: ${allBills.filter(b => b._source === 'recent').length}`);

  // Archive bills (last 3 months)
  console.log('\n--- Fetching archived bills (getBillsArchive) ---');
  afterId = undefined;
  while (true) {
    await delay(200);
    const params: any = { limit: '100' };
    if (afterId) params.after = afterId;

    const bills = await client.getBillsArchive(params);
    const list = Array.isArray(bills) ? bills : [];
    if (list.length === 0) break;

    // Deduplicate (archive might overlap with recent)
    const existingIds = new Set(allBills.map(b => b.billId));
    const newBills = list.filter((b: any) => !existingIds.has(b.billId));
    allBills.push(...newBills.map((b: any) => ({ ...b, _source: 'archive' })));
    console.log(`  Batch: ${list.length} bills (${newBills.length} new)`);

    const lastId = (list[list.length - 1] as any).billId;
    if (afterId === lastId) break;
    afterId = lastId;
    if (list.length < 100) break;
  }

  console.log(`\n  TOTAL BILLS: ${allBills.length}`);

  // ===== Group by type+subType =====
  console.log('\n=== Bills by Type ===');
  const grouped: Record<string, any[]> = {};
  for (const b of allBills) {
    const key = `type=${b.type} subType=${b.subType}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(b);
  }

  for (const [key, bills] of Object.entries(grouped).sort()) {
    const first = bills[0];
    const typeName = BILL_TYPES[first.type] ?? 'Unknown';
    const subTypeName = BILL_SUBTYPES[first.subType] ?? 'Unknown';

    console.log(`\n  ${key} — ${typeName} / ${subTypeName} (${bills.length} bills)`);

    for (const b of bills) {
      const date = new Date(parseInt(b.ts)).toISOString().slice(0, 19);
      const fromAcct = ACCOUNT_NAMES[b.from] ?? `acct:${b.from}`;
      const toAcct = ACCOUNT_NAMES[b.to] ?? `acct:${b.to}`;
      const notes = b.notes || '';

      console.log(
        `    ${date}  ${b.ccy.padEnd(6)} sz=${String(b.sz).padStart(15)} balChg=${String(b.balChg).padStart(20)} bal=${String(b.bal).padStart(20)} ${fromAcct}→${toAcct} ${notes ? `[${notes}]` : ''} (billId=${b.billId})`
      );
    }
  }

  // ===== BRL-specific analysis =====
  console.log('\n=== BRL Analysis ===');
  const brlBills = allBills.filter(b => b.ccy === 'BRL');
  console.log(`  Total BRL bills: ${brlBills.length}`);
  for (const b of brlBills) {
    const date = new Date(parseInt(b.ts)).toISOString().slice(0, 19);
    const typeName = BILL_TYPES[b.type] ?? 'Unknown';
    const subTypeName = BILL_SUBTYPES[b.subType] ?? 'Unknown';
    console.log(
      `  ${date} ${typeName}/${subTypeName} sz=${b.sz} balChg=${b.balChg} bal=${b.bal} instId=${b.instId || '-'}`
    );
  }

  // ===== Convert-specific analysis =====
  console.log('\n=== Convert Analysis (type=30) ===');
  const convertBills = allBills.filter(b => b.type === '30');
  console.log(`  Total convert bills: ${convertBills.length}`);

  // Group converts by timestamp to pair buy/sell
  const convertByTs: Record<string, any[]> = {};
  for (const b of convertBills) {
    if (!convertByTs[b.ts]) convertByTs[b.ts] = [];
    convertByTs[b.ts].push(b);
  }

  console.log(`  Unique convert events: ${Object.keys(convertByTs).length}`);
  for (const [ts, bills] of Object.entries(convertByTs).sort()) {
    const date = new Date(parseInt(ts)).toISOString().slice(0, 19);
    const parts = bills.map(b => {
      const dir = b.subType === '320' ? 'SOLD' : 'BOUGHT';
      return `${dir} ${b.ccy} ${b.sz}`;
    });
    console.log(`  ${date}: ${parts.join(' → ')}`);
  }

  // ===== Transfer analysis =====
  console.log('\n=== Transfer Analysis (type=1) ===');
  const transferBills = allBills.filter(b => b.type === '1');
  console.log(`  Total transfer bills: ${transferBills.length}`);
  for (const b of transferBills) {
    const date = new Date(parseInt(b.ts)).toISOString().slice(0, 19);
    const fromAcct = ACCOUNT_NAMES[b.from] ?? `acct:${b.from}`;
    const toAcct = ACCOUNT_NAMES[b.to] ?? `acct:${b.to}`;
    console.log(
      `  ${date} ${b.ccy.padEnd(6)} ${String(b.sz).padStart(15)} ${fromAcct} → ${toAcct} [${b.notes || ''}]`
    );
  }

  // ===== Summary =====
  console.log('\n=== Summary ===');
  const summary = {
    totalBills: allBills.length,
    byType: Object.entries(grouped).map(([key, bills]) => ({
      key,
      count: bills.length,
      currencies: [...new Set(bills.map(b => b.ccy))].join(', '),
    })),
    brlBills: brlBills.length,
    convertEvents: Object.keys(convertByTs).length,
    dateRange: {
      earliest: new Date(Math.min(...allBills.map(b => parseInt(b.ts)))).toISOString(),
      latest: new Date(Math.max(...allBills.map(b => parseInt(b.ts)))).toISOString(),
    },
  };
  console.log(JSON.stringify(summary, null, 2));

  // Write raw data
  writeFileSync(
    join(OUTPUT_DIR, 'okx-all-bills.json'),
    JSON.stringify(allBills, null, 2),
  );
  console.log(`\n  Written to audit-output/okx-all-bills.json`);

  await prisma.$disconnect();
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
