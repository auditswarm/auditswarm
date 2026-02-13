/**
 * OKX Resync Converts — Fetches bill-based converts and saves to DB.
 *
 * This script:
 *  1. Fetches convert records from OKX bills (type=30)
 *  2. Maps them to Transaction + TransactionFlow records
 *  3. Saves directly to DB, skipping duplicates
 *
 * Usage:
 *   cd auditswarm/backend
 *   NODE_PATH=libs/database/node_modules:node_modules:apps/api/node_modules npx tsx scripts/okx-resync-converts.ts
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
import { createDecipheriv, randomUUID } from 'crypto';
import { OkxConnector } from '../apps/api/src/exchange-connections/connectors/okx-connector';

// polyfill crypto.randomUUID for the script
const crypto = { randomUUID };

const prisma = new PrismaClient();

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

// Stablecoin detection for USD value
const STABLECOINS = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'DAI', 'TUSD', 'USDP', 'USDD', 'USD']);

function estimateUsdValue(record: any, asset: string, amount: number, quoteAsset: string, quoteAmount: number): number | null {
  // If the asset is a stablecoin, amount ≈ USD value
  if (STABLECOINS.has(asset)) return amount;
  if (STABLECOINS.has(quoteAsset)) return quoteAmount;
  // If quote is USD
  if (quoteAsset === 'USD') return quoteAmount;
  if (asset === 'USD') return amount;
  // Use fillIdxPx from raw data (USD index price at time of convert)
  const rawData = record.rawData;
  const idxPx = parseFloat(rawData?.expense?.fillIdxPx || rawData?.income?.fillIdxPx || '0');
  if (idxPx > 0) return amount * idxPx;
  // Can't determine
  return null;
}

// Token symbol to pseudo-mint mapping
async function getTokenMint(symbol: string): Promise<string> {
  const mapping = await prisma.tokenSymbolMapping.findFirst({
    where: { symbol: symbol.toUpperCase() },
  });
  return mapping?.mint ?? `exchange:${symbol.toLowerCase()}`;
}

async function main() {
  console.log('='.repeat(60));
  console.log('  OKX Resync — Bill-Based Converts');
  console.log('='.repeat(60));

  const ENCRYPTION_KEY = process.env.EXCHANGE_ENCRYPTION_KEY!;
  const conn = await prisma.exchangeConnection.findFirst({ where: { exchangeName: 'okx' } });
  if (!conn) { console.error('No OKX connection'); process.exit(1); }

  const apiKey = decrypt(conn.encryptedApiKey, ENCRYPTION_KEY);
  const apiSecret = decrypt(conn.encryptedApiSecret, ENCRYPTION_KEY);
  const passphrase = conn.encryptedPassphrase ? decrypt(conn.encryptedPassphrase, ENCRYPTION_KEY) : '';
  if (!passphrase) { console.error('No passphrase'); process.exit(1); }

  const connector = new OkxConnector(apiKey, apiSecret, passphrase);

  // Fetch Phase 2 (includes bill converts now)
  console.log('\n  Fetching Phase 2 (converts from bills)...');
  const phase2 = await connector.fetchPhase(2, { since: undefined, cursor: {}, fullSync: false });
  console.log(`  Got ${phase2.records.length} convert records`);

  if (phase2.records.length === 0) {
    console.log('  Nothing to import');
    await prisma.$disconnect();
    return;
  }

  // Check for existing transactions to avoid duplicates
  const existingTxs = await prisma.transaction.findMany({
    where: {
      exchangeConnectionId: conn.id,
      source: 'EXCHANGE',
      type: 'EXCHANGE_CONVERT',
    },
    select: { externalId: true },
  });
  const existingIds = new Set(existingTxs.map(t => t.externalId).filter(Boolean));
  console.log(`  Existing convert transactions: ${existingIds.size}`);

  let created = 0;
  let skipped = 0;

  for (const record of phase2.records) {
    if (existingIds.has(record.externalId)) {
      skipped++;
      continue;
    }

    const fromAsset = record.asset;
    const toAsset = record.quoteAsset || '';
    const fromAmount = record.amount;
    const toAmount = record.quoteAmount || 0;
    const usdValue = estimateUsdValue(record, fromAsset, fromAmount, toAsset, toAmount);

    // Get mints
    const fromMint = await getTokenMint(fromAsset);
    const toMint = await getTokenMint(toAsset);

    // Create Transaction + Flows in a transaction
    const txId = crypto.randomUUID();
    const summaryText = `Convert ${fromAmount.toFixed(6)} ${fromAsset} → ${toAmount.toFixed(2)} ${toAsset}`;

    await prisma.$transaction(async (tx) => {
      // Transaction (no userId field — exchange-only txs have no wallet)
      await tx.$executeRaw`
        INSERT INTO transactions (id, type, status, "timestamp", source, "exchangeConnectionId", "exchangeName", "externalId", "totalValueUsd", "rawData", "createdAt", "updatedAt")
        VALUES (
          ${txId},
          'EXCHANGE_CONVERT',
          'CONFIRMED',
          ${record.timestamp},
          'EXCHANGE',
          ${conn.id},
          'okx',
          ${record.externalId || null},
          ${usdValue != null ? usdValue : null}::decimal,
          ${JSON.stringify(record.rawData)}::jsonb,
          NOW(),
          NOW()
        )
      `;

      // Flow 1: OUT (crypto sold)
      await tx.transactionFlow.create({
        data: {
          transactionId: txId,
          walletId: null,
          exchangeConnectionId: conn.id,
          mint: fromMint,
          symbol: fromAsset,
          decimals: 6,
          rawAmount: Math.round(fromAmount * 1e6).toString(),
          amount: new Prisma.Decimal(fromAmount.toString()),
          direction: 'OUT',
          valueUsd: usdValue != null ? new Prisma.Decimal(usdValue) : null,
          isFee: false,
          priceAtExecution: toAmount > 0 && fromAmount > 0
            ? new Prisma.Decimal((toAmount / fromAmount).toFixed(8))
            : null,
        },
      });

      // Flow 2: IN (fiat/crypto received)
      await tx.transactionFlow.create({
        data: {
          transactionId: txId,
          walletId: null,
          exchangeConnectionId: conn.id,
          mint: toMint,
          symbol: toAsset,
          decimals: 2,
          rawAmount: Math.round(toAmount * 100).toString(),
          amount: new Prisma.Decimal(toAmount.toString()),
          direction: 'IN',
          valueUsd: usdValue != null ? new Prisma.Decimal(usdValue) : null,
          isFee: false,
          priceAtExecution: fromAmount > 0 && toAmount > 0
            ? new Prisma.Decimal((fromAmount / toAmount).toFixed(8))
            : null,
        },
      });
    });

    created++;
    console.log(`  Created: ${fromAsset} ${fromAmount} → ${toAsset} ${toAmount.toFixed(2)} (${record.timestamp.toISOString().slice(0, 10)})`);
  }

  console.log(`\n  Summary: ${created} created, ${skipped} skipped (already exist)`);

  // Verify
  const total = await prisma.transaction.count({
    where: { exchangeConnectionId: conn.id, source: 'EXCHANGE' },
  });
  const converts = await prisma.transaction.count({
    where: { exchangeConnectionId: conn.id, source: 'EXCHANGE', type: 'EXCHANGE_CONVERT' },
  });
  console.log(`  DB totals: ${total} transactions (${converts} converts)`);

  await prisma.$disconnect();
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
