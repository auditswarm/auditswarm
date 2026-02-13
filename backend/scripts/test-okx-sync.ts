/**
 * Test OKX Connector — Direct API test.
 *
 * Decrypts OKX credentials from DB, creates OkxConnector, runs all phases,
 * and shows records by type with samples.
 *
 * Usage:
 *   cd auditswarm/backend
 *   NODE_PATH=libs/database/node_modules:node_modules:apps/api/node_modules npx tsx scripts/test-okx-sync.ts
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
import * as crypto from 'crypto';

function decrypt(encryptedHex: string, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey, 'hex');
  const IV_LENGTH = 16;
  const TAG_LENGTH = 16;
  const iv = Buffer.from(encryptedHex.slice(0, IV_LENGTH * 2), 'hex');
  const authTag = Buffer.from(encryptedHex.slice(IV_LENGTH * 2, (IV_LENGTH + TAG_LENGTH) * 2), 'hex');
  const ciphertext = encryptedHex.slice((IV_LENGTH + TAG_LENGTH) * 2);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

import { OkxConnector } from '../apps/api/src/exchange-connections/connectors/okx-connector';

async function main() {
  const p = new PrismaClient();

  const conn = await p.exchangeConnection.findFirst({
    where: { exchangeName: 'okx' },
  });
  if (!conn) {
    console.log('No OKX connection found in DB');
    await p.$disconnect();
    return;
  }

  const encKey = process.env.EXCHANGE_ENCRYPTION_KEY!;
  const apiKey = decrypt(conn.encryptedApiKey, encKey);
  const apiSecret = decrypt(conn.encryptedApiSecret, encKey);
  const passphrase = conn.encryptedPassphrase
    ? decrypt(conn.encryptedPassphrase, encKey)
    : undefined;

  if (!passphrase) {
    console.log('No passphrase found for OKX connection — required');
    await p.$disconnect();
    return;
  }

  console.log(`OKX Connection: ${conn.id}`);
  console.log(`Status: ${conn.status}, Last sync: ${conn.lastSyncAt ?? 'never'}`);
  console.log('Creating OkxConnector...');

  const connector = new OkxConnector(apiKey, apiSecret, passphrase);

  // === Test Connection ===
  console.log('\n=== testConnection() ===');
  const testResult = await connector.testConnection();
  console.log('Valid:', testResult.valid);
  console.log('Permissions:', testResult.permissions);
  console.log('Account ID:', testResult.accountId);
  if (testResult.error) console.log('Error:', testResult.error);

  if (!testResult.valid) {
    console.log('Connection invalid, aborting.');
    await p.$disconnect();
    return;
  }

  // === Phase 1: Core (Deposits, Withdrawals, Trades) ===
  console.log('\n=== fetchPhase(1) — Deposits, Withdrawals, Spot Trades ===');
  try {
    const phase1 = await connector.fetchPhase(1, {
      since: undefined,
      cursor: {},
      fullSync: false,
    });
    printPhaseResult('Phase 1', phase1);
  } catch (e: any) {
    console.log('Phase 1 THREW:', e.message);
    console.log(e.stack?.split('\n').slice(0, 5).join('\n'));
  }

  // === Phase 2: Conversions ===
  console.log('\n=== fetchPhase(2) — Convert, Easy Convert (Dust) ===');
  try {
    const phase2 = await connector.fetchPhase(2, {
      since: undefined,
      cursor: {},
      fullSync: false,
    });
    printPhaseResult('Phase 2', phase2);
  } catch (e: any) {
    console.log('Phase 2 THREW:', e.message);
    console.log(e.stack?.split('\n').slice(0, 5).join('\n'));
  }

  // === Phase 3: Passive Income ===
  console.log('\n=== fetchPhase(3) — Staking, Savings, ETH Staking ===');
  try {
    const phase3 = await connector.fetchPhase(3, {
      since: undefined,
      cursor: {},
      fullSync: false,
    });
    printPhaseResult('Phase 3', phase3);
  } catch (e: any) {
    console.log('Phase 3 THREW:', e.message);
    console.log(e.stack?.split('\n').slice(0, 5).join('\n'));
  }

  // === Phase 4: Advanced ===
  console.log('\n=== fetchPhase(4) — Margin, Swap, Bills Archive ===');
  try {
    const phase4 = await connector.fetchPhase(4, {
      since: undefined,
      cursor: {},
      fullSync: false,
    });
    printPhaseResult('Phase 4', phase4);
  } catch (e: any) {
    console.log('Phase 4 THREW:', e.message);
    console.log(e.stack?.split('\n').slice(0, 5).join('\n'));
  }

  // === Real-Time Balances ===
  console.log('\n=== fetchRealTimeBalances() ===');
  try {
    const balances = await connector.fetchRealTimeBalances();
    console.log(`Balance entries: ${balances.length}`);
    for (const b of balances) {
      console.log(`  ${b.asset.padEnd(10)} free=${String(b.free).padStart(16)} locked=${String(b.locked).padStart(16)} source=${b.source}`);
    }
  } catch (e: any) {
    console.log('Balances THREW:', e.message);
  }

  // === Deposit Addresses ===
  console.log('\n=== fetchDepositAddresses() ===');
  try {
    const addrs = await connector.fetchDepositAddresses();
    console.log(`Address entries: ${addrs.length}`);
    for (const a of addrs.slice(0, 10)) {
      console.log(`  ${(a.coin ?? '').padEnd(8)} ${(a.network ?? 'n/a').padEnd(12)} ${(a.address ?? '').slice(0, 40)}`);
    }
    if (addrs.length > 10) console.log(`  ... and ${addrs.length - 10} more`);
  } catch (e: any) {
    console.log('Addresses THREW:', e.message);
  }

  await p.$disconnect();
}

function printPhaseResult(label: string, result: any) {
  console.log(`${label} records: ${result.records.length}`);
  if (result.errors?.length) console.log(`${label} errors:`, result.errors);
  console.log(`${label} cursor:`, JSON.stringify(result.cursor));

  // Group by type
  const byType: Record<string, ExchangeRecord[]> = {};
  for (const r of result.records) {
    if (!byType[r.type]) byType[r.type] = [];
    byType[r.type].push(r);
  }

  console.log('Records by type:');
  for (const [type, records] of Object.entries(byType)) {
    console.log(`  ${type}: ${records.length}`);

    // Show first 3 samples
    for (const r of records.slice(0, 3)) {
      const parts = [
        r.asset,
        String(r.amount),
        r.priceUsd != null ? `@$${r.priceUsd.toFixed(2)}` : '',
        r.quoteAsset ? `→ ${r.quoteAsset} ${r.quoteAmount ?? ''}` : '',
        r.side ?? '',
        r.tradePair ?? '',
        r.network ?? '',
        r.timestamp.toISOString().slice(0, 19),
      ].filter(Boolean).join(' ');
      console.log(`    ${parts}`);
    }
    if (records.length > 3) console.log(`    ... and ${records.length - 3} more`);
  }

  // Fiat/BRL analysis
  const fiatRecords = result.records.filter((r: any) =>
    ['BRL', 'USD', 'EUR', 'GBP', 'TRY', 'ARS', 'NGN'].includes(r.asset) ||
    ['BRL', 'USD', 'EUR', 'GBP', 'TRY', 'ARS', 'NGN'].includes(r.quoteAsset ?? '')
  );
  if (fiatRecords.length > 0) {
    console.log(`\n  Fiat-related records: ${fiatRecords.length}`);
    for (const r of fiatRecords.slice(0, 10)) {
      console.log(`    ${r.type}: ${r.asset} ${r.amount} → ${r.quoteAsset ?? '-'} ${r.quoteAmount ?? '-'} (${r.timestamp.toISOString().slice(0, 10)})`);
    }
  }
}

// Type import for printPhaseResult
type ExchangeRecord = {
  type: string;
  asset: string;
  amount: number;
  priceUsd?: number | null;
  quoteAsset?: string;
  quoteAmount?: number;
  side?: string;
  tradePair?: string;
  network?: string;
  timestamp: Date;
  externalId?: string;
  [key: string]: any;
};

main().catch(e => console.error('FATAL:', e.message, e.stack));
