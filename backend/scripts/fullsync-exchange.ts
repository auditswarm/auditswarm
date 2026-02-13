/**
 * Full re-sync of exchange connection with 3-year lookback.
 * Standalone script — no NestJS bootstrap required.
 *
 * Usage:
 *   NODE_PATH=libs/database/node_modules:node_modules:apps/indexer/node_modules npx tsx scripts/fullsync-exchange.ts
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { decrypt } from '@auditswarm/common';
import { BinanceConnector } from '../apps/api/src/exchange-connections/connectors/binance-connector';
import { TokenSymbolMappingRepository } from '../libs/database/src/repositories/token-symbol-mapping.repository';
import { ExchangeTransactionMapperService, MappingResult } from '../apps/indexer/src/services/exchange-transaction-mapper.service';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Load .env manually (no dotenv dependency)
function loadEnv(filePath: string) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv(resolve(__dirname, '../.env.local'));
loadEnv(resolve(__dirname, '../.env'));

const ENCRYPTION_KEY = process.env.EXCHANGE_ENCRYPTION_KEY || '';
const TOTAL_PHASES = 4;

const prisma = new PrismaClient();

// Create mapper with a minimal TokenSymbolMappingRepository
function createMapper(): ExchangeTransactionMapperService {
  const repo = new TokenSymbolMappingRepository(prisma as any);
  return new ExchangeTransactionMapperService(repo);
}

async function persistMappedRecords(
  mapped: MappingResult[],
  connectionId: string,
): Promise<number> {
  let created = 0;

  for (const { transaction, flows } of mapped) {
    // Deduplicate by externalId
    const existing = await prisma.transaction.findFirst({
      where: {
        exchangeConnectionId: connectionId,
        externalId: transaction.externalId,
      },
      select: { id: true },
    });

    if (existing) continue;

    // For deposits/withdrawals with txId, check on-chain match
    const rawData = transaction.rawData as any;
    if (rawData?.txId && (transaction.type === 'EXCHANGE_DEPOSIT' || transaction.type === 'EXCHANGE_WITHDRAWAL')) {
      const onChainMatch = await prisma.transaction.findFirst({
        where: { signature: rawData.txId },
        select: { id: true },
      });
      if (onChainMatch) continue;
    }

    const created_tx = await prisma.transaction.create({
      data: {
        walletId: transaction.walletId,
        signature: transaction.signature,
        type: transaction.type,
        status: transaction.status,
        timestamp: transaction.timestamp,
        slot: transaction.slot,
        blockTime: transaction.blockTime,
        fee: transaction.fee,
        feePayer: transaction.feePayer,
        source: transaction.source,
        exchangeConnectionId: transaction.exchangeConnectionId,
        exchangeName: transaction.exchangeName,
        externalId: transaction.externalId,
        category: transaction.category,
        classificationStatus: transaction.category ? 'AUTO_RESOLVED' : null,
        totalValueUsd: transaction.totalValueUsd,
        transfers: transaction.transfers ?? [],
        rawData: transaction.rawData,
      },
    });

    if (flows.length > 0) {
      await prisma.transactionFlow.createMany({
        data: flows.map(f => ({
          transactionId: created_tx.id,
          walletId: f.walletId,
          mint: f.mint,
          decimals: f.decimals,
          rawAmount: f.rawAmount,
          amount: f.amount,
          direction: f.direction,
          valueUsd: f.valueUsd,
          exchangeConnectionId: f.exchangeConnectionId,
          symbol: f.symbol,
          network: f.network,
          isFee: f.isFee,
          priceAtExecution: f.priceAtExecution,
        })),
        skipDuplicates: true,
      });
    }

    created++;
  }

  return created;
}

async function main() {
  console.log('=== Exchange Full Sync (3-year lookback) ===\n');

  if (!ENCRYPTION_KEY) {
    console.error('ERROR: EXCHANGE_ENCRYPTION_KEY not set in .env');
    process.exit(1);
  }

  // Find active connection
  const connection = await prisma.exchangeConnection.findFirst({
    where: { status: 'ACTIVE' },
  });

  if (!connection) {
    console.error('No active exchange connection found!');
    process.exit(1);
  }

  console.log(`Connection: ${connection.exchangeName} (${connection.id})`);
  console.log(`User: ${connection.userId}`);
  console.log(`Last sync: ${connection.lastSyncAt?.toISOString() ?? 'never'}`);
  console.log('');

  // Decrypt keys
  const apiKey = decrypt(connection.encryptedApiKey, ENCRYPTION_KEY);
  const apiSecret = decrypt(connection.encryptedApiSecret, ENCRYPTION_KEY);
  const connector = new BinanceConnector(apiKey, apiSecret);
  const mapper = createMapper();

  let totalRecords = 0;
  const phaseStatus: Record<string, string> = {};
  const syncCursor: Record<string, any> = {};
  const startTime = Date.now();

  for (let phase = 1; phase <= TOTAL_PHASES; phase++) {
    console.log(`Phase ${phase}/${TOTAL_PHASES} starting...`);
    phaseStatus[String(phase)] = 'IN_PROGRESS';

    try {
      const result = await connector.fetchPhase(phase, {
        since: undefined, // fullSync — no since
        cursor: {},       // fresh cursor
        fullSync: true,
      });

      syncCursor[`phase${phase}`] = result.cursor;

      if (result.records.length > 0) {
        console.log(`  Fetched ${result.records.length} records, mapping...`);
        const mapped = await mapper.mapBatch(
          result.records,
          connection.id,
          connection.exchangeName,
        );
        const created = await persistMappedRecords(mapped, connection.id);
        totalRecords += created;
        console.log(`  Created ${created} new records (${result.records.length - created} duplicates skipped)`);
      } else {
        console.log('  No records in this phase');
      }

      if (result.errors.length > 0) {
        console.log(`  Errors: ${result.errors.map(e => e.endpoint).join(', ')}`);
      }

      phaseStatus[String(phase)] = 'DONE';
      console.log(`  Phase ${phase} DONE\n`);
    } catch (error: any) {
      phaseStatus[String(phase)] = 'FAILED';
      console.error(`  Phase ${phase} FAILED: ${error.message}\n`);
    }
  }

  // Cache real-time balances
  try {
    if (connector.fetchRealTimeBalances) {
      const balances = await connector.fetchRealTimeBalances();
      const cachedBalances = { fetchedAt: new Date().toISOString(), balances };
      await prisma.exchangeConnection.update({
        where: { id: connection.id },
        data: { cachedBalances: cachedBalances as any },
      });
      console.log(`Cached ${balances.length} real-time balances`);
    }
  } catch (e: any) {
    console.log(`Failed to cache balances: ${e.message}`);
  }

  // Update sync state
  syncCursor.phaseStatus = phaseStatus;
  await prisma.exchangeConnection.update({
    where: { id: connection.id },
    data: {
      lastSyncAt: new Date(),
      lastError: null,
      syncCursor: syncCursor as any,
    },
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('=== SYNC COMPLETE ===');
  console.log(`Total new records: ${totalRecords}`);
  console.log(`Time: ${elapsed}s`);

  // Post-sync analysis
  console.log('\n--- Post-sync BRL analysis ---');
  const brlFlows = await prisma.transactionFlow.count({ where: { mint: 'fiat:BRL' } });
  const exchangeBrlFlows = await prisma.transactionFlow.count({ where: { mint: 'exchange:BRL' } });
  console.log(`fiat:BRL flows: ${brlFlows}`);
  console.log(`exchange:BRL flows: ${exchangeBrlFlows}`);

  console.log('\n--- Exchange transactions by month (2025) ---');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (let m = 0; m < 12; m++) {
    const start = new Date(2025, m, 1);
    const end = new Date(2025, m + 1, 0, 23, 59, 59);
    const count = await prisma.transaction.count({
      where: { source: 'EXCHANGE', timestamp: { gte: start, lte: end } },
    });
    if (count > 0) console.log(`  ${months[m]}: ${count} txs`);
  }

  // BRL by month
  console.log('\n--- BRL transactions by month ---');
  const brlTxs = await prisma.$queryRaw<Array<{ month: string; count: bigint }>>`
    SELECT to_char(t."timestamp", 'YYYY-MM') as month, COUNT(*) as count
    FROM transactions t
    WHERE t."source" = 'EXCHANGE'
      AND t."rawData"::text LIKE '%BRL%'
    GROUP BY 1 ORDER BY 1
  `;
  for (const row of brlTxs) {
    console.log(`  ${row.month}: ${row.count} txs`);
  }
}

main()
  .catch(err => console.error('Fatal:', err))
  .finally(() => prisma.$disconnect());
