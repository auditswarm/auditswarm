import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExchangeImportRepository } from '@auditswarm/database';
import { ExchangeAdapter, ExchangeRecord } from './adapters/base-adapter';
import { CoinbaseAdapter } from './adapters/coinbase-adapter';
import { BinanceAdapter } from './adapters/binance-adapter';
import { BybitAdapter } from './adapters/bybit-adapter';
import { OkxAdapter } from './adapters/okx-adapter';
import { GenericAdapter } from './adapters/generic-adapter';
import { Prisma } from '@prisma/client';

@Injectable()
export class ExchangeImportsService {
  private adapters: Map<string, ExchangeAdapter>;
  private anthropicApiKey?: string;

  constructor(
    private importRepo: ExchangeImportRepository,
    private configService: ConfigService,
  ) {
    this.anthropicApiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    this.adapters = new Map<string, ExchangeAdapter>([
      ['coinbase', new CoinbaseAdapter()],
      ['binance', new BinanceAdapter()],
      ['bybit', new BybitAdapter()],
      ['okx', new OkxAdapter()],
    ]);
  }

  async upload(
    userId: string,
    exchangeName: string,
    csvContent: string,
    fileName?: string,
  ) {
    // Create import record
    const importRecord = await this.importRepo.create({
      userId,
      exchangeName,
      importType: 'CSV',
      fileName,
      status: 'PROCESSING',
    });

    try {
      // Get or create adapter
      const adapter = this.adapters.get(exchangeName.toLowerCase())
        ?? new GenericAdapter(exchangeName, this.anthropicApiKey);

      // Parse CSV
      let records: ExchangeRecord[];
      let confidence = 1.0;

      if (adapter instanceof GenericAdapter) {
        const result = await adapter.parseAsync(csvContent);
        records = result.records;
        confidence = result.confidence;
      } else {
        records = adapter.parse(csvContent);
      }

      if (records.length === 0) {
        await this.importRepo.updateStatus(importRecord.id, 'FAILED', {
          errorMessage: 'No records found in CSV',
        });
        throw new BadRequestException('No records could be parsed from the CSV');
      }

      // Create exchange transaction records
      const txData: Prisma.ExchangeTransactionCreateManyInput[] = records.map(r => ({
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

      // Update import status
      await this.importRepo.updateStatus(importRecord.id, 'COMPLETED', {
        totalRecords: records.length,
        matchedRecords: 0, // Matching happens later
        unmatchedRecords: records.length,
      });

      return {
        id: importRecord.id,
        exchangeName,
        totalRecords: records.length,
        confidence,
        status: 'COMPLETED',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;

      await this.importRepo.updateStatus(importRecord.id, 'FAILED', {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async findByUserId(userId: string) {
    return this.importRepo.findByUserId(userId);
  }

  async findById(id: string, userId: string) {
    const importRecord = await this.importRepo.findById(id);
    if (!importRecord || importRecord.userId !== userId) {
      throw new NotFoundException('Import not found');
    }
    return importRecord;
  }

  async confirm(id: string, userId: string) {
    const importRecord = await this.findById(id, userId);
    const result = await this.importRepo.confirmMatches(importRecord.id);
    return { confirmed: result.count };
  }

  async delete(id: string, userId: string) {
    const importRecord = await this.findById(id, userId);
    await this.importRepo.delete(importRecord.id);
    return { deleted: true };
  }
}
