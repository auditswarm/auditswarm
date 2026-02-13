/**
 * OKX Full Audit — DB data inspection + API comparison.
 *
 * This script:
 *   1. Queries all OKX transaction data from the DB (grouped by type)
 *   2. Shows deposits, withdrawals, trades, converts with samples
 *   3. Analyzes fiat flows (BRL/USD/EUR/etc.)
 *   4. Fetches real-time balances from OKX API
 *   5. Reconstructs balances from DB flows and compares
 *   6. Writes detailed report files
 *
 * Output files in scripts/audit-output/:
 *   - okx-db-summary.json        → DB transaction counts and totals by type
 *   - okx-db-flows.json          → All DB flows grouped by asset
 *   - okx-real-balances.json     → Current OKX account balances from API
 *   - okx-comparison.json        → Side-by-side balance comparison
 *   - okx-report.txt             → Human-readable report
 *
 * Usage:
 *   cd auditswarm/backend
 *   NODE_PATH=libs/database/node_modules:node_modules:apps/api/node_modules npx tsx scripts/okx-audit.ts
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

import { PrismaClient, Prisma } from '@prisma/client';
import { createDecipheriv } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const OUTPUT_DIR = join(__dirname, 'audit-output');
mkdirSync(OUTPUT_DIR, { recursive: true });

function writeJson(name: string, data: any) {
  writeFileSync(join(OUTPUT_DIR, name), JSON.stringify(data, (_, v) => typeof v === 'bigint' ? Number(v) : v, 2));
  console.log(`  Wrote ${name}`);
}

function writeTxt(name: string, text: string) {
  writeFileSync(join(OUTPUT_DIR, name), text);
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

import { OkxConnector } from '../apps/api/src/exchange-connections/connectors/okx-connector';

// ========== STEP 1: DB Transaction Summary ==========
async function getDbSummary(connectionId: string) {
  console.log('\n=== STEP 1: DB Transaction Summary ===');

  // Transactions by type
  const txByType = await prisma.$queryRaw<{
    type: string;
    count: bigint;
    earliest: Date | null;
    latest: Date | null;
  }[]>`
    SELECT
      t."type",
      COUNT(*)::bigint AS "count",
      MIN(t."timestamp") AS "earliest",
      MAX(t."timestamp") AS "latest"
    FROM transactions t
    WHERE t."exchangeConnectionId" = ${connectionId}
      AND t.source = 'EXCHANGE'
    GROUP BY t."type"
    ORDER BY "count" DESC
  `;

  const summary: any[] = [];
  let totalTxs = 0;

  console.log('\n  Transactions by type:');
  console.log(`  ${'Type'.padEnd(30)} ${'Count'.padStart(8)} ${'Earliest'.padStart(22)} ${'Latest'.padStart(22)}`);
  console.log('  ' + '-'.repeat(84));

  for (const row of txByType) {
    const count = Number(row.count);
    totalTxs += count;
    summary.push({
      type: row.type,
      count,
      earliest: row.earliest?.toISOString(),
      latest: row.latest?.toISOString(),
    });
    console.log(
      `  ${row.type.padEnd(30)} ${String(count).padStart(8)} ${(row.earliest?.toISOString().slice(0, 19) ?? '-').padStart(22)} ${(row.latest?.toISOString().slice(0, 19) ?? '-').padStart(22)}`
    );
  }
  console.log(`\n  Total transactions: ${totalTxs}`);

  // Transactions with USD values
  const usdCoverage = await prisma.$queryRaw<{
    total: bigint;
    with_usd: bigint;
    total_usd: string;
  }[]>`
    SELECT
      COUNT(*)::bigint AS "total",
      COUNT(CASE WHEN t."totalValueUsd" IS NOT NULL AND t."totalValueUsd" > 0 THEN 1 END)::bigint AS "with_usd",
      COALESCE(SUM(t."totalValueUsd"), 0)::text AS "total_usd"
    FROM transactions t
    WHERE t."exchangeConnectionId" = ${connectionId}
      AND t.source = 'EXCHANGE'
  `;

  if (usdCoverage[0]) {
    const total = Number(usdCoverage[0].total);
    const withUsd = Number(usdCoverage[0].with_usd);
    const pct = total > 0 ? ((withUsd / total) * 100).toFixed(1) : '0';
    console.log(`  USD coverage: ${withUsd}/${total} (${pct}%)`);
    console.log(`  Total USD volume: $${parseFloat(usdCoverage[0].total_usd).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }

  writeJson('okx-db-summary.json', { transactions: summary, totalTxs, usdCoverage: usdCoverage[0] });
  return summary;
}

// ========== STEP 2: Sample Transactions by Type ==========
async function showSamplesByType(connectionId: string) {
  console.log('\n=== STEP 2: Sample Transactions ===');

  const types = ['DEPOSIT', 'WITHDRAWAL', 'EXCHANGE_TRADE', 'EXCHANGE_CONVERT',
    'EXCHANGE_DUST_CONVERT', 'STAKE', 'UNSTAKE', 'INTEREST', 'DIVIDEND',
    'MARGIN_BORROW', 'MARGIN_REPAY', 'MARGIN_INTEREST', 'MARGIN_LIQUIDATION'];

  for (const type of types) {
    const samples = await prisma.transaction.findMany({
      where: {
        exchangeConnectionId: connectionId,
        source: 'EXCHANGE',
        type,
      },
      take: 5,
      orderBy: { timestamp: 'desc' },
      include: {
        flows: {
          select: {
            direction: true,
            symbol: true,
            amount: true,
            valueUsd: true,
            isFee: true,
            network: true,
          },
        },
      },
    });

    if (samples.length === 0) continue;

    console.log(`\n  --- ${type} (showing ${samples.length}) ---`);
    for (const tx of samples) {
      const flows = tx.flows.map(f => {
        const dir = f.isFee ? 'FEE' : f.direction;
        const usd = f.valueUsd ? ` ($${Number(f.valueUsd).toFixed(2)})` : '';
        return `${dir} ${f.symbol ?? '?'} ${Number(f.amount).toFixed(6)}${usd}${f.network ? ` [${f.network}]` : ''}`;
      }).join(' | ');

      console.log(`    ${tx.timestamp.toISOString().slice(0, 19)} ${tx.externalId?.slice(0, 20) ?? '-'} :: ${flows}`);
    }
  }
}

// ========== STEP 3: Fiat Flow Analysis ==========
async function analyzeFiatFlows(connectionId: string) {
  console.log('\n=== STEP 3: Fiat Flow Analysis ===');

  const FIAT_SYMBOLS = ['BRL', 'USD', 'EUR', 'GBP', 'TRY', 'ARS', 'NGN', 'JPY', 'KRW'];

  const fiatFlows = await prisma.$queryRaw<{
    symbol: string;
    direction: string;
    is_fee: boolean;
    type: string;
    count: bigint;
    total_amount: string;
    total_usd: string;
  }[]>`
    SELECT
      tf."symbol",
      tf."direction",
      tf."isFee" AS "is_fee",
      t."type",
      COUNT(*)::bigint AS "count",
      SUM(tf."amount")::text AS "total_amount",
      SUM(COALESCE(tf."valueUsd", 0))::text AS "total_usd"
    FROM transaction_flows tf
    JOIN transactions t ON t.id = tf."transactionId"
    WHERE tf."exchangeConnectionId" = ${connectionId}
      AND tf."symbol" IN (${Prisma.join(FIAT_SYMBOLS)})
    GROUP BY tf."symbol", tf."direction", tf."isFee", t."type"
    ORDER BY tf."symbol", t."type"
  `;

  if (fiatFlows.length === 0) {
    console.log('  No fiat flows found');
    return;
  }

  console.log(`\n  ${'Symbol'.padEnd(8)} ${'Direction'.padEnd(10)} ${'Fee?'.padEnd(6)} ${'Type'.padEnd(25)} ${'Count'.padStart(8)} ${'Amount'.padStart(18)} ${'USD'.padStart(14)}`);
  console.log('  ' + '-'.repeat(93));

  for (const f of fiatFlows) {
    const amt = parseFloat(f.total_amount);
    const usd = parseFloat(f.total_usd);
    console.log(
      `  ${f.symbol.padEnd(8)} ${f.direction.padEnd(10)} ${(f.is_fee ? 'YES' : 'no').padEnd(6)} ${f.type.padEnd(25)} ${String(Number(f.count)).padStart(8)} ${amt.toFixed(2).padStart(18)} ${('$' + usd.toFixed(2)).padStart(14)}`
    );
  }

  // Also check for trades involving fiat pairs
  const fiatTrades = await prisma.$queryRaw<{
    symbol: string;
    type: string;
    direction: string;
    count: bigint;
    total: string;
  }[]>`
    SELECT
      tf."symbol",
      t."type",
      tf."direction",
      COUNT(*)::bigint AS "count",
      SUM(tf."amount")::text AS "total"
    FROM transaction_flows tf
    JOIN transactions t ON t.id = tf."transactionId"
    WHERE tf."exchangeConnectionId" = ${connectionId}
      AND t."type" IN ('EXCHANGE_TRADE', 'EXCHANGE_CONVERT', 'EXCHANGE_DUST_CONVERT')
    GROUP BY tf."symbol", t."type", tf."direction"
    HAVING SUM(tf."amount") > 0
    ORDER BY SUM(tf."amount") DESC
    LIMIT 30
  `;

  if (fiatTrades.length > 0) {
    console.log('\n  Top assets in trades/converts:');
    console.log(`  ${'Symbol'.padEnd(12)} ${'Type'.padEnd(25)} ${'Dir'.padEnd(6)} ${'Count'.padStart(8)} ${'Total Amount'.padStart(18)}`);
    console.log('  ' + '-'.repeat(71));
    for (const f of fiatTrades) {
      console.log(
        `  ${f.symbol.padEnd(12)} ${f.type.padEnd(25)} ${f.direction.padEnd(6)} ${String(Number(f.count)).padStart(8)} ${parseFloat(f.total).toFixed(4).padStart(18)}`
      );
    }
  }
}

// ========== STEP 4: DB Flow Reconstruction ==========
async function reconstructFromDB(connectionId: string) {
  console.log('\n=== STEP 4: Reconstructing Balances from DB Flows ===');

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

  const flowData = flows.map(f => ({
    symbol: f.symbol,
    type: f.type,
    direction: f.direction,
    isFee: f.is_fee,
    count: Number(f.count),
    totalAmount: parseFloat(f.total_amount),
    totalUsd: parseFloat(f.total_usd),
  }));
  writeJson('okx-db-flows.json', flowData);

  // Reconstruct balances
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

  for (const b of Object.values(balances)) {
    b.net = b.totalIn - b.totalOut - b.feeOut;
  }

  return balances;
}

// ========== STEP 5: Real-Time Balances + Comparison ==========
async function fetchAndCompare(
  connectionId: string,
  dbRecon: Record<string, any>,
  encKey: string,
) {
  console.log('\n=== STEP 5: Real-Time Balances & Comparison ===');

  const conn = await prisma.exchangeConnection.findUnique({ where: { id: connectionId } });
  if (!conn) {
    console.log('  Connection not found');
    return;
  }

  const apiKey = decrypt(conn.encryptedApiKey, encKey);
  const apiSecret = decrypt(conn.encryptedApiSecret, encKey);
  const passphrase = conn.encryptedPassphrase
    ? decrypt(conn.encryptedPassphrase, encKey)
    : undefined;

  if (!passphrase) {
    console.log('  No passphrase — cannot connect to OKX API');
    return;
  }

  const connector = new OkxConnector(apiKey, apiSecret, passphrase);
  let realBalances: { asset: string; free: string; locked: string; source: string }[];

  try {
    realBalances = await connector.fetchRealTimeBalances();
  } catch (e: any) {
    console.log('  fetchRealTimeBalances FAILED:', e.message);
    return;
  }

  // Group real balances by asset
  const real: Record<string, { free: number; locked: number; total: number; sources: string[] }> = {};
  for (const b of realBalances) {
    if (!real[b.asset]) real[b.asset] = { free: 0, locked: 0, total: 0, sources: [] };
    real[b.asset].free += parseFloat(b.free);
    real[b.asset].locked += parseFloat(b.locked);
    real[b.asset].total += parseFloat(b.free) + parseFloat(b.locked);
    if (!real[b.asset].sources.includes(b.source)) real[b.asset].sources.push(b.source);
  }

  writeJson('okx-real-balances.json', real);

  // Also check cached balances
  const cached = conn.cachedBalances as any;
  if (cached?.balances) {
    console.log(`  Cached balances: ${cached.balances.length} entries (fetched ${cached.fetchedAt})`);
  }

  // Compare
  const allAssets = new Set([
    ...Object.keys(real),
    ...Object.keys(dbRecon),
  ]);

  const report: string[] = [];
  const rows: any[] = [];

  report.push('='.repeat(90));
  report.push('  OKX BALANCE AUDIT REPORT');
  report.push('='.repeat(90));
  report.push(`  Generated: ${new Date().toISOString()}`);
  report.push(`  Connection: ${connectionId}`);
  report.push('');
  report.push('  LEGEND:');
  report.push('    Real     = Current OKX account balance (trading + funding + savings + staking)');
  report.push('    DB Recon = Balance reconstructed from DB transaction flows');
  report.push('');

  report.push(
    '  ' +
    'ASSET'.padEnd(10) +
    'REAL BAL'.padStart(16) +
    'DB RECON'.padStart(16) +
    'DIFF'.padStart(16) +
    'SOURCES'.padStart(20) +
    'STATUS'.padStart(12)
  );
  report.push('  ' + '-'.repeat(88));

  console.log(`\n  ${'ASSET'.padEnd(10)} ${'REAL'.padStart(16)} ${'DB RECON'.padStart(16)} ${'DIFF'.padStart(16)} ${'STATUS'.padStart(10)}`);
  console.log('  ' + '-'.repeat(70));

  for (const asset of [...allAssets].sort()) {
    const realBal = real[asset]?.total ?? 0;
    const dbNet = dbRecon[asset]?.net ?? 0;
    const diff = dbNet - realBal;

    if (Math.abs(realBal) < 0.000001 && Math.abs(dbNet) < 0.000001) continue;

    const status = Math.abs(diff) < 0.01 ? 'OK' : 'MISMATCH';
    const sources = real[asset]?.sources?.join(',') ?? '-';

    rows.push({ asset, realBalance: realBal, dbReconstructed: dbNet, diff, status, sources });

    report.push(
      '  ' +
      asset.padEnd(10) +
      realBal.toFixed(8).padStart(16) +
      dbNet.toFixed(8).padStart(16) +
      ((diff >= 0 ? '+' : '') + diff.toFixed(8)).padStart(16) +
      sources.padStart(20) +
      status.padStart(12)
    );

    const mark = status === 'OK' ? 'v' : 'X';
    console.log(
      `  [${mark}] ${asset.padEnd(8)} ${realBal.toFixed(6).padStart(14)} ${dbNet.toFixed(6).padStart(14)} ${(diff >= 0 ? '+' : '') + diff.toFixed(6).padStart(14)}  ${status}`
    );
  }

  // Detail for mismatches
  const mismatched = rows.filter(r => r.status !== 'OK');
  if (mismatched.length > 0) {
    report.push('');
    report.push('  MISMATCHED ASSETS:');
    for (const row of mismatched) {
      report.push(`\n  --- ${row.asset} ---`);
      report.push(`    Real: ${row.realBalance} (sources: ${row.sources})`);
      report.push(`    DB recon: ${row.dbReconstructed} (diff: ${row.diff.toFixed(8)})`);
      if (dbRecon[row.asset]?.byType) {
        report.push('    DB flows by type:');
        for (const [type, detail] of Object.entries(dbRecon[row.asset].byType)) {
          const d = detail as any;
          report.push(`      ${type.padEnd(25)} IN: ${d.in.toFixed(8).padStart(16)}  OUT: ${d.out.toFixed(8).padStart(16)}  FEE: ${d.feeOut.toFixed(8).padStart(16)}`);
        }
      }
    }
  }

  // Summary
  report.push('');
  report.push('  SUMMARY:');
  const total = rows.length;
  const ok = rows.filter(r => r.status === 'OK').length;
  report.push(`    Total assets: ${total}`);
  report.push(`    OK: ${ok}`);
  report.push(`    Mismatched: ${total - ok}`);
  report.push('');
  report.push('  NOTE: Mismatches are expected if OKX trade history is limited to 3 months');
  report.push('        but the account has been active for longer.');

  writeJson('okx-comparison.json', rows);
  writeTxt('okx-report.txt', report.join('\n'));

  console.log(`\n  Summary: ${ok}/${total} OK, ${total - ok} mismatched`);
}

// ========== Main ==========
async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('  OKX Full Audit');
  console.log('='.repeat(60));

  const ENCRYPTION_KEY = process.env.EXCHANGE_ENCRYPTION_KEY!;
  if (!ENCRYPTION_KEY) {
    console.error('EXCHANGE_ENCRYPTION_KEY not set');
    process.exit(1);
  }

  const connection = await prisma.exchangeConnection.findFirst({
    where: { exchangeName: 'okx' },
  });

  if (!connection) {
    console.error('No OKX connection found in DB');
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`  Connection: ${connection.id}`);
  console.log(`  Status: ${connection.status}`);
  console.log(`  Last sync: ${connection.lastSyncAt ?? 'never'}`);

  // Step 1: DB Summary
  await getDbSummary(connection.id);

  // Step 2: Sample Transactions
  await showSamplesByType(connection.id);

  // Step 3: Fiat analysis
  await analyzeFiatFlows(connection.id);

  // Step 4: Reconstruct from DB
  const dbRecon = await reconstructFromDB(connection.id);

  // Step 5: Real-time balances + comparison
  await fetchAndCompare(connection.id, dbRecon, ENCRYPTION_KEY);

  console.log('\n' + '='.repeat(60));
  console.log('  Audit Complete! Files in scripts/audit-output/');
  console.log('='.repeat(60));

  await prisma.$disconnect();
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
