import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES, JOB_NAMES, AuditJobData } from '@auditswarm/queue';
import { AuditRepository, TransactionRepository, TransactionFlowRepository } from '@auditswarm/database';
import { createAuditGraph } from '../graphs/audit-graph';
import { FxRateService } from '../services/fx-rate.service';
import type { Transaction, AuditResult } from '@auditswarm/common';

/** Well-known Solana mint → symbol mapping for audit display */
const KNOWN_MINT_SYMBOLS: Record<string, string> = {
  'So11111111111111111111111111111111111111112': 'SOL',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL': 'JTO',
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 'JUP',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': 'RAY',
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3': 'PYTH',
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': 'WIF',
  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof': 'RNDR',
  '85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ': 'W',
  'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE': 'ORCA',
  'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey': 'MNDE',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'MSOL',
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': 'JITOSOL',
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1': 'BSOL',
  '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E': 'BTC',
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': 'ETH',
};

/** Resolve a mint to a human-readable symbol */
function resolveSymbol(mint: string, dbSymbol: string | null): string {
  if (dbSymbol) return dbSymbol;
  if (KNOWN_MINT_SYMBOLS[mint]) return KNOWN_MINT_SYMBOLS[mint];
  // exchange:bnb → BNB, binance:BETH → BETH
  if (mint.includes(':')) return mint.split(':')[1].toUpperCase();
  // fiat or unknown — truncate address
  return mint.slice(0, 8);
}

@Processor(QUEUES.AUDIT)
export class AuditProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditProcessor.name);

  constructor(
    private auditRepository: AuditRepository,
    private transactionRepository: TransactionRepository,
    private transactionFlowRepository: TransactionFlowRepository,
  ) {
    super();
  }

  async process(job: Job<AuditJobData>): Promise<AuditResult | null> {
    const { auditId, walletIds, exchangeConnectionIds, jurisdiction, taxYear, options } = job.data;

    this.logger.log(`Processing audit ${auditId} for jurisdiction ${jurisdiction}`);

    try {
      // Update status to processing
      await this.auditRepository.updateStatus(auditId, 'PROCESSING', 0, 'Starting audit...');

      // Create FX rate service for currency conversion (one per audit job)
      const fxService = new FxRateService();

      // Create the audit graph with dependencies
      const graph = createAuditGraph({
        loadTransactions: async (ids: string[], year: number) => {
          return this.loadTransactions(ids, year, exchangeConnectionIds);
        },
        saveResult: async (id: string, result: AuditResult) => {
          return this.saveResult(id, result);
        },
        updateProgress: async (id: string, progress: number, message: string) => {
          await this.auditRepository.updateStatus(id, 'PROCESSING', progress, message);
          await job.updateProgress(progress);
        },
        fxService,
      });

      // Run the graph
      const result = await graph.invoke({
        auditId,
        userId: job.data.userId,
        walletIds,
        jurisdiction,
        taxYear,
        options,
        transactions: [],
        currentStep: '',
        progress: 0,
        errors: [],
        completed: false,
      });

      if (result.errors && result.errors.length > 0) {
        this.logger.error(`Audit ${auditId} completed with errors: ${result.errors.join(', ')}`);
        await this.auditRepository.setError(auditId, result.errors.join('; '));
        return null;
      }

      // Update status to completed
      await this.auditRepository.updateStatus(auditId, 'COMPLETED', 100, 'Audit complete');

      this.logger.log(`Audit ${auditId} completed successfully`);

      return result.auditResult ?? null;
    } catch (error) {
      this.logger.error(`Audit ${auditId} failed: ${error}`);
      await this.auditRepository.setError(
        auditId,
        error instanceof Error ? error.message : 'Unknown error',
      );
      throw error;
    }
  }

  private async loadTransactions(walletIds: string[], taxYear: number, exchangeConnectionIds?: string[]): Promise<Transaction[]> {
    const startDate = new Date(taxYear, 0, 1);
    const endDate = new Date(taxYear, 11, 31, 23, 59, 59);
    const ecIds = exchangeConnectionIds?.length ? exchangeConnectionIds : undefined;

    // Load period transactions + ALL pre-period transactions for cost basis lots
    // Include both on-chain (walletIds) and exchange (exchangeConnectionIds) transactions
    const [periodTxs, prePeriodTxs] = await Promise.all([
      this.transactionRepository.findByFilter({
        walletIds,
        exchangeConnectionIds: ecIds,
        startDate,
        endDate,
      }, { take: 50000 }),
      this.transactionRepository.findByFilter({
        walletIds,
        exchangeConnectionIds: ecIds,
        endDate: new Date(taxYear, 0, 0, 23, 59, 59), // before period
      }, { take: 50000 }),
    ]);

    const allDbTxs = [...prePeriodTxs, ...periodTxs];
    const txIds = allDbTxs.map(tx => tx.id);

    // Load real TransactionFlow records (have valueUsd, direction, isFee)
    const flows = await this.transactionFlowRepository.findByTransactionIds(txIds);

    // Group flows by transactionId
    const flowsByTx = new Map<string, typeof flows>();
    for (const flow of flows) {
      const arr = flowsByTx.get(flow.transactionId) || [];
      arr.push(flow);
      flowsByTx.set(flow.transactionId, arr);
    }

    this.logger.log(
      `Loaded ${periodTxs.length} period + ${prePeriodTxs.length} pre-period txs, ${flows.length} flows`,
    );

    // Map database transactions to common Transaction type using TransactionFlow data
    return allDbTxs.map(tx => {
      const txFlows = flowsByTx.get(tx.id) || [];

      // Convert TransactionFlow records to the transfer format the bee expects
      const transfers = txFlows.map(f => ({
        mint: f.mint,
        symbol: resolveSymbol(f.mint, f.symbol),
        decimals: f.decimals,
        amount: Number(f.amount),
        rawAmount: f.rawAmount,
        direction: f.direction as 'IN' | 'OUT',
        valueUsd: f.valueUsd ? Number(f.valueUsd) : 0,
        isFee: f.isFee || false,
        priceAtExecution: f.priceAtExecution ? Number(f.priceAtExecution) : undefined,
      })) as any[]; // Cast: bee uses Number() internally, TokenTransfer expects bigint

      return {
        id: tx.id,
        walletId: tx.walletId ?? undefined,
        signature: tx.signature ?? undefined,
        type: tx.type as any,
        status: tx.status as any,
        timestamp: tx.timestamp,
        slot: tx.slot ? Number(tx.slot) : undefined,
        blockTime: tx.blockTime ? Number(tx.blockTime) : undefined,
        fee: tx.fee ?? undefined,
        feePayer: tx.feePayer ?? undefined,
        transfers,
        totalValueUsd: tx.totalValueUsd ? Number(tx.totalValueUsd) : undefined,
        source: (tx.source ?? 'ONCHAIN') as any,
        exchangeConnectionId: tx.exchangeConnectionId ?? undefined,
        exchangeName: tx.exchangeName ?? undefined,
        rawData: tx.rawData as Record<string, unknown>,
      };
    });
  }

  private async saveResult(auditId: string, result: AuditResult): Promise<void> {
    // Create the audit result record
    const savedResult = await this.auditRepository.createResult({
      auditId,
      totalTransactions: result.summary.totalTransactions,
      totalWallets: result.summary.totalWallets,
      periodStart: result.summary.periodStart,
      periodEnd: result.summary.periodEnd,
      netGainLoss: result.summary.netGainLoss,
      totalIncome: result.summary.totalIncome,
      estimatedTax: result.summary.estimatedTax,
      currency: result.summary.currency,
      capitalGains: result.capitalGains as any,
      income: result.income as any,
      holdings: result.holdings as any,
      issues: result.issues as any,
      recommendations: result.recommendations as any,
      metadata: {
        ...(result.metadata as any),
        monthlyBreakdown: result.monthlyBreakdown,
        scheduleDSummary: result.scheduleDSummary,
        fbarReport: result.fbarReport,
      } as any,
    });

    // Update audit with result ID
    await this.auditRepository.setResult(auditId, savedResult.id);
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`Job ${job.id} started for audit ${job.data.auditId}`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed for audit ${job.data.auditId}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed for audit ${job.data.auditId}: ${error.message}`);
  }
}
