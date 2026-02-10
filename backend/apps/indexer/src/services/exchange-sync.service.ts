import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ExchangeConnectionRepository,
  ExchangeImportRepository,
  TransactionRepository,
  TransactionFlowRepository,
  WalletRepository,
  PendingClassificationRepository,
  TokenSymbolMappingRepository,
  KnownAddressRepository,
  PrismaService,
} from '@auditswarm/database';
import { decrypt } from '@auditswarm/common';
import { ExchangeTransactionMapperService, MappingResult } from './exchange-transaction-mapper.service';
import { BinanceConnector } from '../../../api/src/exchange-connections/connectors/binance-connector';
import type { SyncPhaseResult } from '../../../api/src/exchange-connections/connectors/base-connector';

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const AMOUNT_TOLERANCE = 0.02;
const TOTAL_PHASES = 4;

@Injectable()
export class ExchangeSyncService {
  private readonly logger = new Logger(ExchangeSyncService.name);
  private readonly encryptionKey: string;

  constructor(
    private prisma: PrismaService,
    private connectionRepo: ExchangeConnectionRepository,
    private importRepo: ExchangeImportRepository,
    private transactionRepo: TransactionRepository,
    private flowRepo: TransactionFlowRepository,
    private walletRepo: WalletRepository,
    private classificationRepo: PendingClassificationRepository,
    private tokenMappingRepo: TokenSymbolMappingRepository,
    private knownAddressRepo: KnownAddressRepository,
    private mapper: ExchangeTransactionMapperService,
    private configService: ConfigService,
  ) {
    this.encryptionKey = this.configService.get<string>('EXCHANGE_ENCRYPTION_KEY', '');
  }

  /**
   * Full multi-phase sync of an exchange connection.
   * Creates Transaction + TransactionFlow records directly in the unified model.
   */
  async syncConnection(connectionId: string, userId: string, fullSync: boolean) {
    const connection = await this.connectionRepo.findById(connectionId);
    if (!connection) throw new Error('Connection not found');

    const apiKey = decrypt(connection.encryptedApiKey, this.encryptionKey);
    const apiSecret = decrypt(connection.encryptedApiSecret, this.encryptionKey);

    if (connection.exchangeName !== 'binance') {
      throw new Error(`Exchange "${connection.exchangeName}" not supported`);
    }

    const connector = new BinanceConnector(apiKey, apiSecret);
    const since = fullSync ? undefined : connection.lastSyncAt ?? undefined;

    const syncCursor: Record<string, any> = (connection.syncCursor as any) ?? {};
    const phaseStatus: Record<string, string> = syncCursor.phaseStatus ?? {};

    let totalRecords = 0;
    let totalErrors = 0;

    for (let phase = 1; phase <= TOTAL_PHASES; phase++) {
      // Always run each phase — the connector's per-endpoint cursors handle
      // incrementality. Passing `since` ensures only new data is fetched.
      // On fullSync, clear phase-specific cursors to re-fetch everything.
      if (fullSync) {
        syncCursor[`phase${phase}`] = {};
      }

      this.logger.log(`Starting phase ${phase}/${TOTAL_PHASES}...`);
      phaseStatus[String(phase)] = 'IN_PROGRESS';
      await this.saveSyncCursor(connectionId, syncCursor, phaseStatus);

      try {
        const phaseCursor = syncCursor[`phase${phase}`] ?? {};
        const result = await connector.fetchPhase(phase, {
          since,
          cursor: phaseCursor,
          fullSync,
        });

        // Save phase cursor for resume
        syncCursor[`phase${phase}`] = result.cursor;

        if (result.records.length > 0) {
          // Map and persist records
          const mapped = await this.mapper.mapBatch(
            result.records,
            connectionId,
            connection.exchangeName,
          );
          const created = await this.persistMappedRecords(mapped, connectionId);
          totalRecords += created;
        }

        if (result.errors.length > 0) {
          totalErrors += result.errors.length;
          this.logger.warn(
            `Phase ${phase} had ${result.errors.length} endpoint errors: ${result.errors.map(e => e.endpoint).join(', ')}`,
          );
        }

        phaseStatus[String(phase)] = 'DONE';
        this.logger.log(`Phase ${phase} complete: ${result.records.length} records`);
      } catch (error: any) {
        phaseStatus[String(phase)] = 'FAILED';
        this.logger.error(`Phase ${phase} failed: ${error.message}`);
        await this.saveSyncCursor(connectionId, syncCursor, phaseStatus);
        // Continue to next phase instead of aborting entirely
      }

      await this.saveSyncCursor(connectionId, syncCursor, phaseStatus);
    }

    // Fetch and cache real-time balances from exchange API
    let cachedBalances: any = null;
    try {
      if (connector.fetchRealTimeBalances) {
        const balances = await connector.fetchRealTimeBalances();
        cachedBalances = { fetchedAt: new Date().toISOString(), balances };
        this.logger.log(`Cached ${balances.length} real-time balances`);
      }
    } catch (error: any) {
      this.logger.warn(`Failed to fetch real-time balances: ${error.message}`);
    }

    // Extract and save deposit addresses from rawData + API
    await this.extractAndSaveDepositAddresses(connectionId, connection.exchangeName, connector);

    // Update connection state
    await this.prisma.exchangeConnection.update({
      where: { id: connectionId },
      data: {
        lastSyncAt: new Date(),
        lastError: totalErrors > 0 ? `${totalErrors} endpoint errors` : null,
        ...(cachedBalances ? { cachedBalances } : {}),
      },
    });

    // Run reconciliation after all phases (uses saved deposit addresses)
    const reconcileResult = await this.reconcileUnified(connectionId, userId);

    this.logger.log(
      `Sync complete: ${totalRecords} records, ${reconcileResult.matched} matched, ${reconcileResult.addressClassified ?? 0} address-classified, ${reconcileResult.offRamps} off-ramps`,
    );

    return {
      totalRecords,
      ...reconcileResult,
      phaseStatus,
    };
  }

  /**
   * Sync a single phase (called by queue processor for granular jobs).
   */
  async syncPhase(
    connectionId: string,
    userId: string,
    phase: number,
    fullSync: boolean,
  ) {
    const connection = await this.connectionRepo.findById(connectionId);
    if (!connection) throw new Error('Connection not found');

    const apiKey = decrypt(connection.encryptedApiKey, this.encryptionKey);
    const apiSecret = decrypt(connection.encryptedApiSecret, this.encryptionKey);

    const connector = new BinanceConnector(apiKey, apiSecret);
    const since = fullSync ? undefined : connection.lastSyncAt ?? undefined;

    const syncCursor: Record<string, any> = (connection.syncCursor as any) ?? {};
    const phaseStatus: Record<string, string> = syncCursor.phaseStatus ?? {};
    const phaseCursor = syncCursor[`phase${phase}`] ?? {};

    phaseStatus[String(phase)] = 'IN_PROGRESS';
    await this.saveSyncCursor(connectionId, syncCursor, phaseStatus);

    const result = await connector.fetchPhase(phase, {
      since,
      cursor: phaseCursor,
      fullSync,
    });

    syncCursor[`phase${phase}`] = result.cursor;

    let created = 0;
    if (result.records.length > 0) {
      const mapped = await this.mapper.mapBatch(
        result.records,
        connectionId,
        connection.exchangeName,
      );
      created = await this.persistMappedRecords(mapped, connectionId);
    }

    phaseStatus[String(phase)] = result.errors.length > 0 ? 'PARTIAL' : 'DONE';
    await this.saveSyncCursor(connectionId, syncCursor, phaseStatus);

    return { phase, created, errors: result.errors };
  }

  /**
   * Persist mapped transactions + flows with deduplication on externalId.
   */
  private async persistMappedRecords(
    mapped: MappingResult[],
    connectionId: string,
  ): Promise<number> {
    let created = 0;

    for (const { transaction, flows } of mapped) {
      // Check deduplication by externalId + connectionId
      const existing = await this.prisma.transaction.findFirst({
        where: {
          exchangeConnectionId: connectionId,
          externalId: transaction.externalId,
        },
        select: { id: true },
      });

      if (existing) continue;

      // For deposits/withdrawals with a txId, check if on-chain tx exists
      const rawData = transaction.rawData as any;
      if (rawData?.txId && (transaction.type === 'EXCHANGE_DEPOSIT' || transaction.type === 'EXCHANGE_WITHDRAWAL')) {
        const onChainMatch = await this.prisma.transaction.findFirst({
          where: { signature: rawData.txId },
          select: { id: true },
        });

        if (onChainMatch) {
          // Link instead of creating new — set linkedTransactionId
          await this.prisma.transaction.update({
            where: { id: onChainMatch.id },
            data: { linkedTransactionId: null }, // will be set by reconciliation
          });
          continue;
        }
      }

      // Create transaction (including transfers JSON for bee compatibility)
      const created_tx = await this.prisma.transaction.create({
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

      // Create flows
      if (flows.length > 0) {
        await this.prisma.transactionFlow.createMany({
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

  /**
   * Reconciliation on the unified Transaction table.
   * Links exchange DEPOSIT/WITHDRAWAL with matching on-chain transfers.
   */
  async reconcileUnified(connectionId: string, userId: string) {
    const wallets = await this.walletRepo.findByUserId(userId);
    const walletIds = wallets.map(w => w.id);
    if (walletIds.length === 0) return { matched: 0, unmatched: 0, offRamps: 0 };

    // Get exchange deposits and withdrawals
    const exchangeDeposits = await this.prisma.transaction.findMany({
      where: {
        exchangeConnectionId: connectionId,
        type: 'EXCHANGE_DEPOSIT',
        linkedTransactionId: null,
      },
      include: { flows: true },
    });

    const exchangeWithdrawals = await this.prisma.transaction.findMany({
      where: {
        exchangeConnectionId: connectionId,
        type: 'EXCHANGE_WITHDRAWAL',
        linkedTransactionId: null,
      },
      include: { flows: true },
    });

    // Get exchange sells for off-ramp detection
    const exchangeSells = await this.prisma.transaction.findMany({
      where: {
        exchangeConnectionId: connectionId,
        type: { in: ['EXCHANGE_TRADE', 'EXCHANGE_FIAT_SELL'] },
      },
      select: { id: true, timestamp: true, type: true, totalValueUsd: true, flows: true },
    });

    let matched = 0;
    let offRamps = 0;

    // Match deposits with on-chain TRANSFER_OUT
    for (const deposit of exchangeDeposits) {
      const flow = deposit.flows[0];
      if (!flow) continue;

      const asset = flow.symbol ?? flow.mint;
      const amount = Number(flow.amount);

      const match = await this.findOnChainMatch(
        walletIds, asset, amount, deposit.timestamp,
        'TRANSFER_OUT', ONE_HOUR_MS, true,
        deposit.rawData,
      );

      if (match) {
        // Set bidirectional link
        await this.prisma.$transaction([
          this.prisma.transaction.update({
            where: { id: deposit.id },
            data: { linkedTransactionId: match.id },
          }),
          this.prisma.transaction.update({
            where: { id: match.id },
            data: { linkedTransactionId: deposit.id },
          }),
        ]);
        matched++;

        // Off-ramp detection: deposit + sell within 24h
        const sellAfter = exchangeSells.find(s => {
          const timeDiff = s.timestamp.getTime() - deposit.timestamp.getTime();
          return timeDiff >= 0 && timeDiff < 24 * ONE_HOUR_MS;
        });

        if (sellAfter) {
          offRamps++;
          await this.classificationRepo.create({
            userId,
            transactionId: match.id,
            type: 'OFFRAMP',
            status: 'PENDING',
            priority: 10,
            suggestedCategory: 'DISPOSAL_SALE',
            estimatedValueUsd: sellAfter.totalValueUsd ?? undefined,
            notes: `Off-ramp detected: exchange deposit followed by sell within 24h`,
          });
        }
      }
    }

    // Match withdrawals with on-chain TRANSFER_IN
    for (const withdrawal of exchangeWithdrawals) {
      const flow = withdrawal.flows[0];
      if (!flow) continue;

      const asset = flow.symbol ?? flow.mint;
      const amount = Number(flow.amount);

      const match = await this.findOnChainMatch(
        walletIds, asset, amount, withdrawal.timestamp,
        'TRANSFER_IN', TWO_HOURS_MS, false,
        withdrawal.rawData,
      );

      if (match) {
        await this.prisma.$transaction([
          this.prisma.transaction.update({
            where: { id: withdrawal.id },
            data: { linkedTransactionId: match.id },
          }),
          this.prisma.transaction.update({
            where: { id: match.id },
            data: { linkedTransactionId: withdrawal.id },
          }),
        ]);
        matched++;
      }
    }

    // Strategy 3: Classify on-chain sends to known exchange deposit addresses
    const addressClassified = await this.classifyByDepositAddress(walletIds, connectionId);

    const total = exchangeDeposits.length + exchangeWithdrawals.length;
    this.logger.log(`Address-based classification: ${addressClassified} transactions → TRANSFER_TO_EXCHANGE`);
    return { matched, unmatched: total - matched, offRamps, addressClassified };
  }

  private async findOnChainMatch(
    walletIds: string[], asset: string, amount: number, exchangeTimestamp: Date,
    onChainType: string, timeWindowMs: number, onChainBefore: boolean,
    rawData?: any,
  ): Promise<{ id: string; confidence: number } | null> {
    // Strategy 1: Direct txId match (exchange deposits/withdrawals often include the on-chain signature)
    const txId = rawData?.txId;
    if (txId) {
      const directMatch = await this.transactionRepo.findBySignature(txId);
      if (directMatch && !(directMatch as any).linkedTransactionId) {
        return { id: directMatch.id, confidence: 1 };
      }
    }

    // Strategy 2: Scored matching by amount and time
    const windowStart = onChainBefore
      ? new Date(exchangeTimestamp.getTime() - timeWindowMs)
      : exchangeTimestamp;
    const windowEnd = onChainBefore
      ? exchangeTimestamp
      : new Date(exchangeTimestamp.getTime() + timeWindowMs);

    const candidates = await this.transactionRepo.findByFilter(
      {
        walletIds,
        types: [onChainType],
        startDate: windowStart,
        endDate: windowEnd,
      },
      { take: 200, sortBy: 'timestamp', sortOrder: onChainBefore ? 'desc' : 'asc' },
    );

    // Use TokenSymbolMappingRepository for asset → mint resolution
    const resolved = await this.tokenMappingRepo.resolveToMint(asset);
    const targetMint = resolved.mint;

    let bestMatch: { id: string; confidence: number } | null = null;
    let bestScore = Infinity;

    for (const tx of candidates) {
      if ((tx as any).linkedTransactionId) continue;

      for (const t of (tx.transfers as any[]) ?? []) {
        const tMint = t.mint ?? '';
        if (tMint !== targetMint) continue;

        const amountDiff = Math.abs(Math.abs(t.amount ?? 0) - amount) / Math.max(amount, 0.0001);
        if (amountDiff > AMOUNT_TOLERANCE) continue;

        const timeDiff = Math.abs(tx.timestamp.getTime() - exchangeTimestamp.getTime());
        const score = amountDiff * 0.7 + (timeDiff / timeWindowMs) * 0.3;

        if (score < bestScore) {
          bestScore = score;
          bestMatch = { id: tx.id, confidence: Math.max(0, 1 - score) };
        }
      }
    }

    return bestMatch;
  }

  /**
   * Extract deposit addresses from exchange deposit rawData and API,
   * then save them as KnownAddress entries for address-based reconciliation.
   */
  private async extractAndSaveDepositAddresses(
    connectionId: string,
    exchangeName: string,
    connector: BinanceConnector,
  ): Promise<string[]> {
    const addresses = new Set<string>();
    let saved = 0;

    // Source 1: Extract from existing EXCHANGE_DEPOSIT rawData
    const deposits = await this.prisma.$queryRaw<
      Array<{ address: string; coin: string; network: string }>
    >`
      SELECT DISTINCT
        "rawData"->>'address' as address,
        "rawData"->>'coin' as coin,
        "rawData"->>'network' as network
      FROM transactions
      WHERE "exchangeConnectionId" = ${connectionId}
        AND "type" = 'EXCHANGE_DEPOSIT'
        AND "rawData"->>'address' IS NOT NULL
    `;

    for (const d of deposits) {
      if (!d.address || addresses.has(d.address)) continue;
      addresses.add(d.address);

      const existing = await this.knownAddressRepo.findByAddress(d.address);
      if (!existing) {
        await this.knownAddressRepo.upsert(d.address, {
          name: `${exchangeName} Deposit`,
          label: `${exchangeName.toUpperCase()}_DEPOSIT_${d.network ?? 'UNKNOWN'}`,
          entityType: 'EXCHANGE',
          source: 'SYNC',
          isVerified: true,
          metadata: { exchangeName, network: d.network, coins: [d.coin] },
        });
        saved++;
      }
    }

    // Source 2: Fetch deposit addresses from exchange API
    try {
      if (connector.fetchDepositAddresses) {
        const apiAddresses = await connector.fetchDepositAddresses();
        for (const addr of apiAddresses) {
          if (!addr.address || addresses.has(addr.address)) continue;
          addresses.add(addr.address);

          const existing = await this.knownAddressRepo.findByAddress(addr.address);
          if (!existing) {
            await this.knownAddressRepo.upsert(addr.address, {
              name: `${exchangeName} Deposit`,
              label: `${exchangeName.toUpperCase()}_DEPOSIT_${addr.network}`,
              entityType: 'EXCHANGE',
              source: 'API',
              isVerified: true,
              metadata: { exchangeName, network: addr.network, coin: addr.coin, tag: addr.tag },
            });
            saved++;
          }
        }
      }
    } catch (error: any) {
      this.logger.warn(`Failed to fetch deposit addresses via API: ${error.message}`);
    }

    if (saved > 0) {
      this.logger.log(`Saved ${saved} new exchange deposit addresses as KnownAddress`);
    }

    return [...addresses];
  }

  /**
   * Classify on-chain TRANSFER_OUTs that go to known exchange deposit addresses.
   * This works even when exchange deposit records are missing (API history limits).
   */
  private async classifyByDepositAddress(
    walletIds: string[],
    connectionId: string,
  ): Promise<number> {
    // Get all exchange deposit addresses
    const exchangeAddresses = await this.knownAddressRepo.findByEntityType('EXCHANGE');
    if (exchangeAddresses.length === 0) return 0;

    let classified = 0;

    for (const knownAddr of exchangeAddresses) {
      const pattern = '%' + knownAddr.address + '%';

      // Find on-chain TRANSFER_OUTs/UNKNOWNs whose transfers JSON contains the deposit address
      const sends = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM transactions
        WHERE "source" = 'ONCHAIN'
          AND "walletId" = ANY(${walletIds})
          AND "type" IN ('TRANSFER_OUT', 'UNKNOWN')
          AND "transfers"::text LIKE ${pattern}
          AND ("category" IS NULL OR "category" != 'TRANSFER_TO_EXCHANGE')
        LIMIT 500
      `;

      for (const s of sends) {
        await this.prisma.transaction.update({
          where: { id: s.id },
          data: {
            category: 'TRANSFER_TO_EXCHANGE',
            classificationStatus: 'AUTO_RESOLVED',
          },
        });
        classified++;
      }
    }

    return classified;
  }

  private async saveSyncCursor(
    connectionId: string,
    syncCursor: Record<string, any>,
    phaseStatus: Record<string, string>,
  ): Promise<void> {
    syncCursor.phaseStatus = phaseStatus;
    await this.prisma.exchangeConnection.update({
      where: { id: connectionId },
      data: { syncCursor: syncCursor as any },
    });
  }
}
