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

// Import the actual connector
import { BybitConnector } from '../apps/api/src/exchange-connections/connectors/bybit-connector';

async function main() {
  const p = new PrismaClient();
  const conn = await p.exchangeConnection.findFirst({ where: { exchangeName: 'bybit' } });
  if (!conn) {
    console.log('No bybit connection');
    return;
  }

  const encKey = process.env.EXCHANGE_ENCRYPTION_KEY!;
  const apiKey = decrypt(conn.encryptedApiKey, encKey);
  const apiSecret = decrypt(conn.encryptedApiSecret, encKey);

  console.log('Creating BybitConnector...');
  const connector = new BybitConnector(apiKey, apiSecret);

  // Test connection first
  console.log('\n=== testConnection() ===');
  const testResult = await connector.testConnection();
  console.log('Valid:', testResult.valid, 'Permissions:', testResult.permissions);

  // Run Phase 1 exactly like the sync does
  console.log('\n=== fetchPhase(1, {}) — simulating first sync ===');
  try {
    const phase1 = await connector.fetchPhase(1, {
      since: undefined,
      cursor: {},
      fullSync: false,
    });
    console.log('Phase 1 records:', phase1.records.length);
    console.log('Phase 1 errors:', phase1.errors);
    console.log('Phase 1 cursor:', JSON.stringify(phase1.cursor));

    // Group by type
    const byType: Record<string, number> = {};
    for (const r of phase1.records) {
      byType[r.type] = (byType[r.type] || 0) + 1;
    }
    console.log('Records by type:', byType);

    // Show samples
    for (const r of phase1.records.slice(0, 5)) {
      console.log(`  ${r.type}: ${r.asset} ${r.amount} @ ${r.timestamp.toISOString()} (${r.externalId?.substring(0, 40)})`);
    }
  } catch (e: any) {
    console.log('Phase 1 THREW:', e.message);
    console.log(e.stack);
  }

  // Run Phase 2
  console.log('\n=== fetchPhase(2, {}) ===');
  try {
    const phase2 = await connector.fetchPhase(2, {
      since: undefined,
      cursor: {},
      fullSync: false,
    });
    console.log('Phase 2 records:', phase2.records.length);
    console.log('Phase 2 errors:', phase2.errors);

    for (const r of phase2.records.slice(0, 5)) {
      console.log(`  ${r.type}: ${r.asset} ${r.amount} -> ${r.quoteAsset} ${r.quoteAmount}`);
    }
  } catch (e: any) {
    console.log('Phase 2 THREW:', e.message);
  }

  // Test fetchRealTimeBalances
  console.log('\n=== fetchRealTimeBalances() ===');
  try {
    const balances = await connector.fetchRealTimeBalances();
    console.log('Balance entries:', balances.length);
    for (const b of balances) {
      console.log(`  ${b.asset}: free=${b.free} locked=${b.locked} source=${b.source}`);
    }
  } catch (e: any) {
    console.log('Balances THREW:', e.message);
  }

  await p.$disconnect();
}

main().catch(e => console.error('FATAL:', e.message, e.stack));
