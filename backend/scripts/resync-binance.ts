/**
 * Full re-sync of Binance exchange connection.
 * Uses BinanceConnector directly (with fixed pagination) + Prisma for persistence.
 * No NestJS bootstrap needed — standalone script.
 *
 * Usage:
 *   cd auditswarm/backend
 *   NODE_PATH=node_modules npx tsx scripts/resync-binance.ts --full --clean
 *
 * Flags:
 *   --full   Full sync (reset all cursors, re-fetch everything)
 *   --clean  Delete all existing exchange transactions before sync (use with --full)
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createDecipheriv } from 'crypto';
import { MainClient } from 'binance';

const prisma = new PrismaClient();

// ========== Crypto helpers ==========
function decrypt(encryptedHex: string, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey, 'hex');
  const IV_LENGTH = 16;
  const TAG_LENGTH = 16;
  const iv = Buffer.from(encryptedHex.slice(0, IV_LENGTH * 2), 'hex');
  const authTag = Buffer.from(encryptedHex.slice(IV_LENGTH * 2, (IV_LENGTH + TAG_LENGTH) * 2), 'hex');
  const ciphertext = encryptedHex.slice((IV_LENGTH + TAG_LENGTH) * 2);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ========== Token helpers ==========
const STABLECOINS = new Set([
  'USDT', 'USDC', 'BUSD', 'FDUSD', 'USD1', 'DAI', 'TUSD', 'USDP', 'GUSD', 'FRAX',
  'PYUSD', 'USDD', 'CUSD', 'SUSD', 'LUSD', 'EURC', 'AEUR',
]);
const FIAT_CURRENCIES = new Set([
  'USD', 'BRL', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'TRY', 'RUB', 'NGN',
  'ARS', 'COP', 'KES', 'ZAR', 'INR', 'IDR', 'PHP', 'VND', 'THB', 'MYR',
]);

function isUsdLike(symbol: string): boolean {
  return STABLECOINS.has(symbol.toUpperCase()) || symbol.toUpperCase() === 'USD';
}
function isFiat(symbol: string): boolean {
  return FIAT_CURRENCIES.has(symbol.toUpperCase());
}

async function resolveToken(symbol: string, network?: string | null): Promise<{ mint: string; decimals: number }> {
  const upper = symbol.toUpperCase();
  if (network) {
    const exact = await prisma.tokenSymbolMapping.findUnique({
      where: { symbol_network: { symbol: upper, network } },
    });
    if (exact) return { mint: exact.mint, decimals: exact.decimals };
  }
  const defaultMapping = await prisma.tokenSymbolMapping.findFirst({
    where: { symbol: upper, isDefault: true },
  });
  if (defaultMapping) return { mint: defaultMapping.mint, decimals: defaultMapping.decimals };
  const any = await prisma.tokenSymbolMapping.findFirst({ where: { symbol: upper } });
  if (any) return { mint: any.mint, decimals: any.decimals };
  return { mint: `exchange:${upper}`, decimals: 8 };
}

// ========== Flow helpers ==========
function createFlow(
  connectionId: string, mint: string, decimals: number, symbol: string,
  amount: number, direction: 'IN' | 'OUT', priceUsd: number | null | undefined,
  network: string | null | undefined, isFee: boolean,
) {
  const safeDecimals = Math.min(decimals, 18);
  const rawAmount = Math.round(amount * Math.pow(10, decimals)).toString();
  const decimalAmount = new Prisma.Decimal(amount.toFixed(safeDecimals));

  let resolvedPrice = priceUsd;
  if ((resolvedPrice == null || resolvedPrice === 0) && isUsdLike(symbol)) {
    resolvedPrice = 1.0;
  }

  const valueUsd = resolvedPrice != null && resolvedPrice > 0
    ? new Prisma.Decimal((amount * resolvedPrice).toFixed(8))
    : null;

  return {
    walletId: null as string | null,
    mint,
    decimals,
    rawAmount,
    amount: decimalAmount,
    direction,
    valueUsd,
    exchangeConnectionId: connectionId,
    symbol: symbol.toUpperCase(),
    network: network ?? null,
    isFee,
    priceAtExecution: resolvedPrice != null && resolvedPrice > 0
      ? new Prisma.Decimal(resolvedPrice.toFixed(8))
      : null,
  };
}

function parseSymbol(symbol: string): { base: string; quote: string } {
  const knownQuotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'BNB', 'BRL', 'EUR', 'USD', 'TRY'];
  for (const q of knownQuotes) {
    if (symbol.endsWith(q)) return { base: symbol.slice(0, -q.length), quote: q };
  }
  return { base: symbol.slice(0, -4), quote: symbol.slice(-4) };
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ========== ExchangeRecord type ==========
interface ExchangeRecord {
  externalId: string;
  type: string;
  timestamp: Date;
  asset: string;
  amount: number;
  priceUsd?: number;
  totalValueUsd?: number;
  feeAmount?: number;
  feeAsset?: string;
  side?: string;
  tradePair?: string;
  quoteAsset?: string;
  quoteAmount?: number;
  network?: string;
  txId?: string;
  isP2P?: boolean;
  rawData?: any;
}

// ========== Mapping logic (inline from ExchangeTransactionMapperService) ==========
async function mapRecord(
  record: ExchangeRecord,
  connectionId: string,
): Promise<{ type: string; category: string; flows: ReturnType<typeof createFlow>[] } | null> {
  const flows: ReturnType<typeof createFlow>[] = [];

  switch (record.type) {
    case 'TRADE': {
      const resolved = await resolveToken(record.asset);
      const isBuy = record.side === 'BUY';
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), isBuy ? 'IN' : 'OUT', record.priceUsd, record.network, false));
      if (record.quoteAsset && record.quoteAmount) {
        const quoteResolved = await resolveToken(record.quoteAsset);
        flows.push(createFlow(connectionId, quoteResolved.mint, quoteResolved.decimals, record.quoteAsset,
          Math.abs(record.quoteAmount), isBuy ? 'OUT' : 'IN', null, record.network, false));
      }
      if (record.feeAmount && record.feeAmount > 0 && record.feeAsset) {
        const feeResolved = await resolveToken(record.feeAsset);
        flows.push(createFlow(connectionId, feeResolved.mint, feeResolved.decimals, record.feeAsset,
          record.feeAmount, 'OUT', null, record.network, true));
      }
      return { type: 'EXCHANGE_TRADE', category: 'TRADE', flows };
    }
    case 'DEPOSIT': {
      const resolved = await resolveToken(record.asset);
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), 'IN', record.priceUsd, record.network, false));
      return { type: isFiat(record.asset) ? 'EXCHANGE_FIAT_BUY' : 'EXCHANGE_DEPOSIT', category: 'TRANSFER', flows };
    }
    case 'WITHDRAWAL': {
      const resolved = await resolveToken(record.asset);
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), 'OUT', record.priceUsd, record.network, false));
      if (record.feeAmount && record.feeAmount > 0 && record.feeAsset) {
        const feeResolved = await resolveToken(record.feeAsset);
        flows.push(createFlow(connectionId, feeResolved.mint, feeResolved.decimals, record.feeAsset,
          record.feeAmount, 'OUT', null, record.network, true));
      }
      return { type: isFiat(record.asset) ? 'EXCHANGE_FIAT_SELL' : 'EXCHANGE_WITHDRAWAL', category: 'TRANSFER', flows };
    }
    case 'FIAT_BUY': {
      const resolved = await resolveToken(record.asset);
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), 'IN', record.priceUsd, record.network, false));
      if (record.feeAmount && record.feeAmount > 0 && record.feeAsset) {
        const feeResolved = await resolveToken(record.feeAsset);
        flows.push(createFlow(connectionId, feeResolved.mint, feeResolved.decimals, record.feeAsset,
          record.feeAmount, 'OUT', null, record.network, true));
      }
      return { type: 'EXCHANGE_FIAT_BUY', category: 'ACQUISITION', flows };
    }
    case 'FIAT_SELL': {
      const resolved = await resolveToken(record.asset);
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), 'OUT', record.priceUsd, record.network, false));
      if (record.feeAmount && record.feeAmount > 0 && record.feeAsset) {
        const feeResolved = await resolveToken(record.feeAsset);
        flows.push(createFlow(connectionId, feeResolved.mint, feeResolved.decimals, record.feeAsset,
          record.feeAmount, 'OUT', null, record.network, true));
      }
      return { type: 'EXCHANGE_FIAT_SELL', category: 'DISPOSAL', flows };
    }
    case 'CONVERT':
    case 'DUST_CONVERT': {
      const sourceResolved = await resolveToken(record.asset);
      flows.push(createFlow(connectionId, sourceResolved.mint, sourceResolved.decimals, record.asset,
        Math.abs(record.amount), 'OUT', record.priceUsd, record.network, false));
      if (record.quoteAsset && record.quoteAmount) {
        const targetResolved = await resolveToken(record.quoteAsset);
        flows.push(createFlow(connectionId, targetResolved.mint, targetResolved.decimals, record.quoteAsset,
          Math.abs(record.quoteAmount), 'IN', null, record.network, false));
      }
      if (record.feeAmount && record.feeAmount > 0 && record.feeAsset) {
        const feeResolved = await resolveToken(record.feeAsset);
        flows.push(createFlow(connectionId, feeResolved.mint, feeResolved.decimals, record.feeAsset,
          record.feeAmount, 'OUT', null, record.network, true));
      }
      const t = record.type === 'DUST_CONVERT' ? 'EXCHANGE_DUST_CONVERT' : 'EXCHANGE_CONVERT';
      return { type: t, category: 'TRADE', flows };
    }
    case 'C2C_TRADE': {
      const resolved = await resolveToken(record.asset);
      const isBuy = record.side === 'BUY';
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), isBuy ? 'IN' : 'OUT', record.priceUsd, record.network, false));
      return { type: 'EXCHANGE_C2C_TRADE', category: isBuy ? 'ACQUISITION' : 'DISPOSAL', flows };
    }
    case 'STAKE': {
      const resolved = await resolveToken(record.asset);
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), 'OUT', record.priceUsd, record.network, false));
      if (record.quoteAsset && record.quoteAmount) {
        const quoteResolved = await resolveToken(record.quoteAsset);
        flows.push(createFlow(connectionId, quoteResolved.mint, quoteResolved.decimals, record.quoteAsset,
          Math.abs(record.quoteAmount), 'IN', null, record.network, false));
      }
      return { type: 'EXCHANGE_STAKE', category: 'STAKE', flows };
    }
    case 'UNSTAKE': {
      const resolved = await resolveToken(record.asset);
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), 'IN', record.priceUsd, record.network, false));
      return { type: 'EXCHANGE_UNSTAKE', category: 'UNSTAKE', flows };
    }
    case 'INTEREST':
    case 'MINING': {
      const resolved = await resolveToken(record.asset);
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), 'IN', record.priceUsd, record.network, false));
      return { type: 'EXCHANGE_INTEREST', category: 'INCOME', flows };
    }
    case 'DIVIDEND': {
      const resolved = await resolveToken(record.asset);
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), 'IN', record.priceUsd, record.network, false));
      return { type: 'EXCHANGE_DIVIDEND', category: 'INCOME', flows };
    }
    case 'MARGIN_BORROW': {
      const resolved = await resolveToken(record.asset);
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), 'IN', record.priceUsd, record.network, false));
      return { type: 'MARGIN_BORROW', category: 'MARGIN', flows };
    }
    case 'MARGIN_REPAY': {
      const resolved = await resolveToken(record.asset);
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), 'OUT', record.priceUsd, record.network, false));
      return { type: 'MARGIN_REPAY', category: 'MARGIN', flows };
    }
    case 'MARGIN_INTEREST': {
      const resolved = await resolveToken(record.asset);
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), 'OUT', record.priceUsd, record.network, false));
      return { type: 'MARGIN_INTEREST', category: 'EXPENSE', flows };
    }
    case 'MARGIN_LIQUIDATION': {
      const resolved = await resolveToken(record.asset);
      flows.push(createFlow(connectionId, resolved.mint, resolved.decimals, record.asset,
        Math.abs(record.amount), 'OUT', record.priceUsd, record.network, false));
      return { type: 'MARGIN_LIQUIDATION', category: 'LOSS', flows };
    }
    default:
      return null;
  }
}

// ========== Reconciliation ==========
async function reconcile(connectionId: string, userId: string) {
  console.log('\n--- RECONCILIATION ---');

  const wallets = await prisma.wallet.findMany({ where: { userId }, select: { id: true } });
  const walletIds = wallets.map(w => w.id);
  if (walletIds.length === 0) { console.log('  No wallets found'); return { matched: 0 }; }

  const deposits = await prisma.transaction.findMany({
    where: { exchangeConnectionId: connectionId, type: 'EXCHANGE_DEPOSIT', linkedTransactionId: null },
    include: { flows: true },
  });
  const withdrawals = await prisma.transaction.findMany({
    where: { exchangeConnectionId: connectionId, type: 'EXCHANGE_WITHDRAWAL', linkedTransactionId: null },
    include: { flows: true },
  });

  console.log(`  Unlinked deposits: ${deposits.length}, withdrawals: ${withdrawals.length}`);

  let matched = 0;

  for (const dep of deposits) {
    // Try direct txId match first
    const txId = (dep.rawData as any)?.txId;
    if (txId) {
      const onChain = await prisma.transaction.findUnique({ where: { signature: txId }, select: { id: true, linkedTransactionId: true } });
      if (onChain && !onChain.linkedTransactionId) {
        await prisma.$transaction([
          prisma.transaction.update({ where: { id: dep.id }, data: { linkedTransactionId: onChain.id } }),
          prisma.transaction.update({ where: { id: onChain.id }, data: { linkedTransactionId: dep.id } }),
        ]);
        matched++;
        continue;
      }
    }

    // Fall back to amount+time matching
    const flow = dep.flows[0];
    if (!flow) continue;
    const asset = flow.symbol ?? flow.mint;
    const amount = Number(flow.amount);
    const resolved = await resolveToken(asset);

    const candidates = await prisma.transaction.findMany({
      where: {
        walletId: { in: walletIds },
        type: 'TRANSFER_OUT',
        linkedTransactionId: null,
        timestamp: {
          gte: new Date(dep.timestamp.getTime() - 60 * 60 * 1000),
          lte: dep.timestamp,
        },
      },
      select: { id: true, timestamp: true, transfers: true },
      take: 200,
      orderBy: { timestamp: 'desc' },
    });

    for (const tx of candidates) {
      for (const t of (tx.transfers as any[]) ?? []) {
        if (t.mint !== resolved.mint) continue;
        const diff = Math.abs(Math.abs(t.amount ?? 0) - amount) / Math.max(amount, 0.0001);
        if (diff > 0.02) continue;

        await prisma.$transaction([
          prisma.transaction.update({ where: { id: dep.id }, data: { linkedTransactionId: tx.id } }),
          prisma.transaction.update({ where: { id: tx.id }, data: { linkedTransactionId: dep.id } }),
        ]);
        matched++;
        break;
      }
      if ((await prisma.transaction.findUnique({ where: { id: dep.id }, select: { linkedTransactionId: true } }))?.linkedTransactionId) break;
    }
  }

  for (const wd of withdrawals) {
    const txId = (wd.rawData as any)?.txId;
    if (txId) {
      const onChain = await prisma.transaction.findUnique({ where: { signature: txId }, select: { id: true, linkedTransactionId: true } });
      if (onChain && !onChain.linkedTransactionId) {
        await prisma.$transaction([
          prisma.transaction.update({ where: { id: wd.id }, data: { linkedTransactionId: onChain.id } }),
          prisma.transaction.update({ where: { id: onChain.id }, data: { linkedTransactionId: wd.id } }),
        ]);
        matched++;
        continue;
      }
    }

    const flow = wd.flows[0];
    if (!flow) continue;
    const asset = flow.symbol ?? flow.mint;
    const amount = Number(flow.amount);
    const resolved = await resolveToken(asset);

    const candidates = await prisma.transaction.findMany({
      where: {
        walletId: { in: walletIds },
        type: 'TRANSFER_IN',
        linkedTransactionId: null,
        timestamp: {
          gte: wd.timestamp,
          lte: new Date(wd.timestamp.getTime() + 2 * 60 * 60 * 1000),
        },
      },
      select: { id: true, timestamp: true, transfers: true },
      take: 200,
      orderBy: { timestamp: 'asc' },
    });

    for (const tx of candidates) {
      for (const t of (tx.transfers as any[]) ?? []) {
        if (t.mint !== resolved.mint) continue;
        const diff = Math.abs(Math.abs(t.amount ?? 0) - amount) / Math.max(amount, 0.0001);
        if (diff > 0.02) continue;

        await prisma.$transaction([
          prisma.transaction.update({ where: { id: wd.id }, data: { linkedTransactionId: tx.id } }),
          prisma.transaction.update({ where: { id: tx.id }, data: { linkedTransactionId: wd.id } }),
        ]);
        matched++;
        break;
      }
      if ((await prisma.transaction.findUnique({ where: { id: wd.id }, select: { linkedTransactionId: true } }))?.linkedTransactionId) break;
    }
  }

  console.log(`  Matched: ${matched} / ${deposits.length + withdrawals.length}`);
  return { matched };
}

// ========== Main ==========
async function main() {
  const fullSync = process.argv.includes('--full');
  const cleanSync = process.argv.includes('--clean');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Binance Re-Sync (${fullSync ? 'FULL' : 'INCREMENTAL'}${cleanSync ? ' + CLEAN' : ''})`);
  console.log(`${'='.repeat(60)}\n`);

  const ENCRYPTION_KEY = process.env.EXCHANGE_ENCRYPTION_KEY ?? 'ef6b7e0342cd23ed007cb51aaecf447ef6a6138c882b0de9931c719967f11955';

  const connection = await prisma.exchangeConnection.findFirst({
    where: { exchangeName: 'binance', status: 'ACTIVE' },
  });
  if (!connection) { console.error('No active Binance connection found'); process.exit(1); }

  const apiKey = decrypt(connection.encryptedApiKey, ENCRYPTION_KEY);
  const apiSecret = decrypt(connection.encryptedApiSecret, ENCRYPTION_KEY);

  console.log(`Connection: ${connection.id}`);
  console.log(`User: ${connection.userId}\n`);

  // Pre-sync stats
  const beforeStats = await getStats(connection.id);
  console.log('--- BEFORE ---');
  printStats(beforeStats);

  // Clean
  if (cleanSync) {
    console.log('\nCleaning existing exchange data...');
    // Clear linked references first
    await prisma.transaction.updateMany({
      where: {
        linkedTransactionId: { not: null },
        OR: [
          { exchangeConnectionId: connection.id },
          { linkedTransactionId: { in: (await prisma.transaction.findMany({ where: { exchangeConnectionId: connection.id }, select: { id: true } })).map(t => t.id) } },
        ],
      },
      data: { linkedTransactionId: null },
    });
    const deletedFlows = await prisma.transactionFlow.deleteMany({ where: { exchangeConnectionId: connection.id } });
    const deletedTxs = await prisma.transaction.deleteMany({ where: { exchangeConnectionId: connection.id } });
    console.log(`  Deleted ${deletedFlows.count} flows, ${deletedTxs.count} transactions`);
  }

  // Reset cursor
  if (fullSync) {
    console.log('\nResetting sync cursor...');
    await prisma.exchangeConnection.update({
      where: { id: connection.id },
      data: { syncCursor: {}, lastSyncAt: null },
    });
  }

  // Import and use BinanceConnector with all fixes
  const { BinanceConnector } = await import('../apps/api/src/exchange-connections/connectors/binance-connector');
  const connector = new BinanceConnector(apiKey, apiSecret);

  const since = fullSync ? undefined : connection.lastSyncAt ?? undefined;
  const TOTAL_PHASES = 4;
  let totalRecords = 0;
  let totalErrors = 0;
  const startTime = Date.now();

  for (let phase = 1; phase <= TOTAL_PHASES; phase++) {
    console.log(`\n=== PHASE ${phase}/${TOTAL_PHASES} ===`);

    try {
      const result = await connector.fetchPhase(phase, {
        since: since ?? undefined,
        cursor: {},
        fullSync,
      });

      console.log(`  Records: ${result.records.length}`);
      if (result.errors.length > 0) {
        totalErrors += result.errors.length;
        console.log(`  Errors: ${result.errors.map(e => e.endpoint).join(', ')}`);
      }

      // Map and persist
      let phaseCreated = 0;
      for (const record of result.records) {
        const mapped = await mapRecord(record, connection.id);
        if (!mapped) continue;

        // Dedup
        const existing = await prisma.transaction.findFirst({
          where: { exchangeConnectionId: connection.id, externalId: record.externalId },
          select: { id: true },
        });
        if (existing) continue;

        // Build transfers JSON
        const transfers = mapped.flows.map(f => ({
          mint: f.mint, symbol: f.symbol, amount: Number(f.amount), direction: f.direction,
          from: f.direction === 'OUT' ? 'exchange:binance' : 'external',
          to: f.direction === 'IN' ? 'exchange:binance' : 'external',
          valueUsd: f.valueUsd ? Number(f.valueUsd) : undefined,
          isFee: f.isFee,
          priceAtExecution: f.priceAtExecution ? Number(f.priceAtExecution) : undefined,
        }));

        // Compute total value
        const nonFee = mapped.flows.filter(f => !f.isFee);
        const withVal = nonFee.filter(f => f.valueUsd !== null);
        let txValue: Prisma.Decimal | null = null;
        if (withVal.length > 0) {
          txValue = withVal.reduce((s, f) => s.add(f.valueUsd!), new Prisma.Decimal(0));
        } else if (record.totalValueUsd) {
          txValue = new Prisma.Decimal(record.totalValueUsd);
        }

        const createdTx = await prisma.transaction.create({
          data: {
            walletId: null,
            signature: null,
            type: mapped.type,
            status: 'CONFIRMED',
            timestamp: record.timestamp,
            slot: null,
            blockTime: null,
            fee: null,
            feePayer: null,
            source: 'EXCHANGE',
            exchangeConnectionId: connection.id,
            exchangeName: 'binance',
            externalId: record.externalId,
            category: mapped.category,
            totalValueUsd: txValue,
            transfers,
            rawData: record.rawData ?? (record as any),
          },
        });

        if (mapped.flows.length > 0) {
          await prisma.transactionFlow.createMany({
            data: mapped.flows.map(f => ({ ...f, transactionId: createdTx.id })),
            skipDuplicates: true,
          });
        }

        phaseCreated++;
      }

      totalRecords += phaseCreated;
      console.log(`  Created: ${phaseCreated} new records`);
    } catch (error: any) {
      console.error(`  Phase ${phase} FAILED: ${error.message}`);
      totalErrors++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nSync completed in ${elapsed}s — ${totalRecords} new records, ${totalErrors} errors`);

  // Fetch and cache real-time balances
  console.log('\n--- FETCHING REAL-TIME BALANCES ---');
  let realTimeBalances: { asset: string; free: number; locked: number; source: string }[] = [];
  try {
    realTimeBalances = await connector.fetchRealTimeBalances();
    console.log(`  Fetched ${realTimeBalances.length} balance entries`);
    for (const b of realTimeBalances) {
      const total = b.free + b.locked;
      if (total > 0.00001) {
        console.log(`    ${b.asset.padEnd(8)} ${total.toFixed(8)}  (${b.source})`);
      }
    }
  } catch (error: any) {
    console.error(`  Failed: ${error.message}`);
  }

  // Update connection with balances
  await prisma.exchangeConnection.update({
    where: { id: connection.id },
    data: {
      lastSyncAt: new Date(),
      cachedBalances: realTimeBalances.length > 0
        ? { fetchedAt: new Date().toISOString(), balances: realTimeBalances }
        : undefined,
    },
  });

  // Reconciliation
  await reconcile(connection.id, connection.userId);

  // Post-sync stats
  const afterStats = await getStats(connection.id);
  console.log('\n--- AFTER ---');
  printStats(afterStats);

  // Delta
  console.log('\n--- DELTA ---');
  console.log(`  New transactions: +${afterStats.total - beforeStats.total}`);
  console.log(`  New trades:       +${afterStats.trades - beforeStats.trades}`);
  console.log(`  New converts:     +${afterStats.converts - beforeStats.converts}`);
  console.log(`  New deposits:     +${afterStats.deposits - beforeStats.deposits}`);
  console.log(`  New withdrawals:  +${afterStats.withdrawals - beforeStats.withdrawals}`);
  console.log(`  Linked (recon):   ${afterStats.linked}`);

  // Data quality
  const quality = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN "totalValueUsd" IS NOT NULL AND "totalValueUsd" > 0 THEN 1 END) as with_usd,
      COUNT(CASE WHEN transfers IS NOT NULL AND jsonb_array_length(transfers::jsonb) > 0 THEN 1 END) as with_transfers,
      SUM(COALESCE("totalValueUsd", 0))::numeric(18,2) as total_volume_usd
    FROM transactions
    WHERE "exchangeConnectionId" = ${connection.id}
  `;
  console.log('\n--- DATA QUALITY ---');
  if (quality[0]) {
    const q = quality[0];
    const pctUsd = Number(q.total) > 0 ? ((Number(q.with_usd) / Number(q.total)) * 100).toFixed(1) : '0';
    const pctTransfers = Number(q.total) > 0 ? ((Number(q.with_transfers) / Number(q.total)) * 100).toFixed(1) : '0';
    console.log(`  USD values:   ${q.with_usd}/${q.total} (${pctUsd}%)`);
    console.log(`  Transfers:    ${q.with_transfers}/${q.total} (${pctTransfers}%)`);
    console.log(`  Total volume: $${Number(q.total_volume_usd).toLocaleString()}`);
  }

  // Type breakdown
  const typeBreakdown = await prisma.$queryRaw<any[]>`
    SELECT type, COUNT(*)::int as count,
      SUM(COALESCE("totalValueUsd", 0))::numeric(18,2) as total_usd
    FROM transactions
    WHERE "exchangeConnectionId" = ${connection.id}
    GROUP BY type ORDER BY count DESC
  `;
  console.log('\n--- TYPE BREAKDOWN ---');
  console.table(typeBreakdown);

  console.log('\nDone!');
}

// ========== Stats helpers ==========
interface Stats {
  total: number; trades: number; converts: number; deposits: number;
  withdrawals: number; fiatBuys: number; fiatSells: number; interest: number;
  dividends: number; stakes: number; unstakes: number; linked: number;
}

async function getStats(connectionId: string): Promise<Stats> {
  const [total, trades, converts, deposits, withdrawals, fiatBuys, fiatSells, interest, dividends, stakes, unstakes, linked] = await Promise.all([
    prisma.transaction.count({ where: { exchangeConnectionId: connectionId } }),
    prisma.transaction.count({ where: { exchangeConnectionId: connectionId, type: 'EXCHANGE_TRADE' } }),
    prisma.transaction.count({ where: { exchangeConnectionId: connectionId, type: 'EXCHANGE_CONVERT' } }),
    prisma.transaction.count({ where: { exchangeConnectionId: connectionId, type: 'EXCHANGE_DEPOSIT' } }),
    prisma.transaction.count({ where: { exchangeConnectionId: connectionId, type: 'EXCHANGE_WITHDRAWAL' } }),
    prisma.transaction.count({ where: { exchangeConnectionId: connectionId, type: 'EXCHANGE_FIAT_BUY' } }),
    prisma.transaction.count({ where: { exchangeConnectionId: connectionId, type: 'EXCHANGE_FIAT_SELL' } }),
    prisma.transaction.count({ where: { exchangeConnectionId: connectionId, type: 'EXCHANGE_INTEREST' } }),
    prisma.transaction.count({ where: { exchangeConnectionId: connectionId, type: 'EXCHANGE_DIVIDEND' } }),
    prisma.transaction.count({ where: { exchangeConnectionId: connectionId, type: 'EXCHANGE_STAKE' } }),
    prisma.transaction.count({ where: { exchangeConnectionId: connectionId, type: 'EXCHANGE_UNSTAKE' } }),
    prisma.transaction.count({ where: { exchangeConnectionId: connectionId, linkedTransactionId: { not: null } } }),
  ]);
  return { total, trades, converts, deposits, withdrawals, fiatBuys, fiatSells, interest, dividends, stakes, unstakes, linked };
}

function printStats(s: Stats) {
  console.log(`  Total:       ${s.total}`);
  console.log(`  Trades:      ${s.trades}`);
  console.log(`  Converts:    ${s.converts}`);
  console.log(`  Deposits:    ${s.deposits}`);
  console.log(`  Withdrawals: ${s.withdrawals}`);
  console.log(`  Fiat buys:   ${s.fiatBuys}`);
  console.log(`  Fiat sells:  ${s.fiatSells}`);
  console.log(`  Interest:    ${s.interest}`);
  console.log(`  Dividends:   ${s.dividends}`);
  console.log(`  Stakes:      ${s.stakes}`);
  console.log(`  Unstakes:    ${s.unstakes}`);
  console.log(`  Linked:      ${s.linked}`);
}

main()
  .catch(e => { console.error('Fatal:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
