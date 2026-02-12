import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  ExchangeConnectionRepository,
  ExchangeImportRepository,
} from '@auditswarm/database';
import { encrypt, decrypt } from '@auditswarm/common';
import { QUEUES, JOB_NAMES } from '@auditswarm/queue';
import { ExchangeApiConnector } from './connectors/base-connector';
import { BinanceConnector } from './connectors/binance-connector';
import { BybitConnector } from './connectors/bybit-connector';
import { OkxConnector } from './connectors/okx-connector';
import { Prisma } from '@prisma/client';

@Injectable()
export class ExchangeConnectionsService {
  private readonly logger = new Logger(ExchangeConnectionsService.name);
  private readonly encryptionKey: string;

  constructor(
    private connectionRepo: ExchangeConnectionRepository,
    private importRepo: ExchangeImportRepository,
    private configService: ConfigService,
    @InjectQueue(QUEUES.INDEXER) private indexerQueue: Queue,
  ) {
    this.encryptionKey = this.configService.get<string>('EXCHANGE_ENCRYPTION_KEY', '');
    if (!this.encryptionKey) {
      this.logger.warn('EXCHANGE_ENCRYPTION_KEY not set — exchange connections will fail');
    }
  }

  async link(userId: string, exchangeName: string, apiKey: string, apiSecret: string, subAccountLabel?: string, passphrase?: string) {
    const normalizedName = exchangeName.toLowerCase();

    // Check for existing active connection
    const existing = await this.connectionRepo.findActiveByUserAndExchange(userId, normalizedName, subAccountLabel);
    if (existing) {
      throw new ConflictException(`Already linked to ${exchangeName}${subAccountLabel ? ` (${subAccountLabel})` : ''}`);
    }

    // Test credentials
    const connector = this.createConnector(normalizedName, apiKey, apiSecret, passphrase);
    const testResult = await connector.testConnection();

    if (!testResult.valid) {
      throw new BadRequestException(`Connection failed: ${testResult.error}`);
    }

    // Encrypt and store
    const connection = await this.connectionRepo.create({
      userId,
      exchangeName: normalizedName,
      encryptedApiKey: encrypt(apiKey, this.encryptionKey),
      encryptedApiSecret: encrypt(apiSecret, this.encryptionKey),
      encryptedPassphrase: passphrase ? encrypt(passphrase, this.encryptionKey) : undefined,
      subAccountLabel,
      status: 'ACTIVE',
      permissions: testResult.permissions,
    });

    return {
      id: connection.id,
      exchangeName: normalizedName,
      status: 'ACTIVE',
      permissions: testResult.permissions,
      accountId: testResult.accountId,
    };
  }

  async findByUserId(userId: string) {
    const connections = await this.connectionRepo.findByUserId(userId);
    return connections.map(c => ({
      id: c.id,
      exchangeName: c.exchangeName,
      status: c.status,
      subAccountLabel: c.subAccountLabel,
      permissions: c.permissions,
      lastSyncAt: c.lastSyncAt,
      lastError: c.lastError,
      createdAt: c.createdAt,
    }));
  }

  async testConnection(id: string, userId: string) {
    const connection = await this.getConnection(id, userId);
    const connector = this.getConnectorForConnection(connection);
    const result = await connector.testConnection();

    if (!result.valid) {
      await this.connectionRepo.updateStatus(id, 'ERROR', { lastError: result.error });
    } else {
      await this.connectionRepo.updateStatus(id, 'ACTIVE', { lastError: undefined, permissions: result.permissions });
    }

    return result;
  }

  async sync(id: string, userId: string, fullSync = false) {
    const connection = await this.getConnection(id, userId);

    if (connection.status !== 'ACTIVE') {
      throw new BadRequestException(`Connection status is ${connection.status} — cannot sync`);
    }

    // Dispatch async sync job
    await this.indexerQueue.add(
      JOB_NAMES.SYNC_EXCHANGE_CONNECTION,
      {
        connectionId: id,
        userId,
        exchangeName: connection.exchangeName,
        fullSync,
      },
      {
        jobId: `sync-exchange-${id}-${Date.now()}`,
        priority: 5,
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
      },
    );

    return { status: 'SYNC_QUEUED', connectionId: id };
  }

  /**
   * Called by the indexer processor to perform the actual sync.
   */
  async performSync(connectionId: string, userId: string, fullSync: boolean) {
    const connection = await this.connectionRepo.findById(connectionId);
    if (!connection) throw new NotFoundException('Connection not found');

    const connector = this.getConnectorForConnection(connection);
    const cursor = fullSync ? {} : (connection.syncCursor as any) ?? {};
    const since = fullSync ? undefined : connection.lastSyncAt ?? undefined;

    // Create import record
    const importRecord = await this.importRepo.create({
      userId,
      exchangeName: connection.exchangeName,
      importType: 'API',
      connectionId,
      status: 'PROCESSING',
    });

    try {
      const allRecords: any[] = [];

      // Fetch all data types
      this.logger.log(`Syncing ${connection.exchangeName} trades...`);
      const trades = await connector.fetchTrades({ since, cursor: cursor.trades });

      this.logger.log(`Syncing ${connection.exchangeName} deposits...`);
      const deposits = await connector.fetchDeposits({ since });

      this.logger.log(`Syncing ${connection.exchangeName} withdrawals...`);
      const withdrawals = await connector.fetchWithdrawals({ since });

      this.logger.log(`Syncing ${connection.exchangeName} fiat transactions...`);
      const fiat = await connector.fetchFiatTransactions({ since });

      allRecords.push(...trades.records, ...deposits.records, ...withdrawals.records, ...fiat.records);

      if (allRecords.length === 0) {
        await this.importRepo.updateStatus(importRecord.id, 'COMPLETED', {
          totalRecords: 0,
        });
        await this.connectionRepo.updateSyncState(connectionId, {
          lastSyncAt: new Date(),
          lastError: null,
        });
        return { importId: importRecord.id, totalRecords: 0 };
      }

      // Store as ExchangeTransactions
      const txData: Prisma.ExchangeTransactionCreateManyInput[] = allRecords.map(r => ({
        importId: importRecord.id,
        externalId: r.externalId,
        type: r.type,
        timestamp: r.timestamp,
        asset: r.asset,
        amount: new Prisma.Decimal(r.amount.toString()),
        priceUsd: r.priceUsd != null ? new Prisma.Decimal(r.priceUsd.toFixed(8)) : null,
        totalValueUsd: r.totalValueUsd != null ? new Prisma.Decimal(r.totalValueUsd.toFixed(8)) : null,
        feeAmount: r.feeAmount != null ? new Prisma.Decimal(r.feeAmount.toString()) : null,
        feeAsset: r.feeAsset,
        side: r.side,
        tradePair: r.tradePair,
        rawData: r.rawData as any,
      }));

      await this.importRepo.createTransactions(txData);

      await this.importRepo.updateStatus(importRecord.id, 'COMPLETED', {
        totalRecords: allRecords.length,
      });

      // Update sync state
      await this.connectionRepo.updateSyncState(connectionId, {
        lastSyncAt: new Date(),
        lastError: null,
        syncCursor: { trades: trades.cursor },
      });

      // Dispatch reconciliation
      await this.indexerQueue.add(
        JOB_NAMES.RECONCILE_EXCHANGE,
        { importId: importRecord.id, userId },
        { jobId: `reconcile-${importRecord.id}`, priority: 5 },
      );

      this.logger.log(`Sync complete for ${connection.exchangeName}: ${allRecords.length} records`);
      return { importId: importRecord.id, totalRecords: allRecords.length };
    } catch (error: any) {
      await this.importRepo.updateStatus(importRecord.id, 'FAILED', {
        errorMessage: error.message,
      });
      await this.connectionRepo.updateSyncState(connectionId, {
        lastError: error.message,
      });
      throw error;
    }
  }

  async unlink(id: string, userId: string) {
    await this.getConnection(id, userId);
    await this.connectionRepo.delete(id);
    return { deleted: true };
  }

  async getStatus(id: string, userId: string) {
    const connection = await this.getConnection(id, userId);
    const cursor = (connection.syncCursor as any) ?? {};
    const phaseStatus = cursor.phaseStatus ?? {};

    // Count transactions sourced from this connection
    const totalTransactions = await this.connectionRepo.countTransactions(id);

    return {
      id: connection.id,
      exchangeName: connection.exchangeName,
      status: connection.status,
      syncProgress: {
        phase1: phaseStatus['1'] ?? 'PENDING',
        phase2: phaseStatus['2'] ?? 'PENDING',
        phase3: phaseStatus['3'] ?? 'PENDING',
        phase4: phaseStatus['4'] ?? 'PENDING',
      },
      totalTransactions,
      lastSyncAt: connection.lastSyncAt,
      lastError: connection.lastError,
    };
  }

  // -- Helpers --

  private async getConnection(id: string, userId: string) {
    const connection = await this.connectionRepo.findById(id);
    if (!connection || connection.userId !== userId) {
      throw new NotFoundException('Exchange connection not found');
    }
    return connection;
  }

  getConnectorForConnection(connection: any): ExchangeApiConnector {
    const apiKey = decrypt(connection.encryptedApiKey, this.encryptionKey);
    const apiSecret = decrypt(connection.encryptedApiSecret, this.encryptionKey);
    const passphrase = connection.encryptedPassphrase
      ? decrypt(connection.encryptedPassphrase, this.encryptionKey) : undefined;
    return this.createConnector(connection.exchangeName, apiKey, apiSecret, passphrase);
  }

  private createConnector(exchangeName: string, apiKey: string, apiSecret: string, passphrase?: string): ExchangeApiConnector {
    switch (exchangeName) {
      case 'binance':
        return new BinanceConnector(apiKey, apiSecret);
      case 'bybit':
        return new BybitConnector(apiKey, apiSecret);
      case 'okx':
        if (!passphrase) throw new BadRequestException('OKX requires a passphrase');
        return new OkxConnector(apiKey, apiSecret, passphrase);
      default:
        throw new BadRequestException(`Exchange "${exchangeName}" is not supported for API connection`);
    }
  }
}
