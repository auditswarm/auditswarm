import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES, JOB_NAMES, AuditJobData } from '@auditswarm/queue';
import { AuditRepository, TransactionRepository } from '@auditswarm/database';
import { createAuditGraph } from '../graphs/audit-graph';
import type { Transaction, AuditResult } from '@auditswarm/common';

@Processor(QUEUES.AUDIT)
export class AuditProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditProcessor.name);

  constructor(
    private auditRepository: AuditRepository,
    private transactionRepository: TransactionRepository,
  ) {
    super();
  }

  async process(job: Job<AuditJobData>): Promise<AuditResult | null> {
    const { auditId, walletIds, jurisdiction, taxYear, options } = job.data;

    this.logger.log(`Processing audit ${auditId} for jurisdiction ${jurisdiction}`);

    try {
      // Update status to processing
      await this.auditRepository.updateStatus(auditId, 'PROCESSING', 0, 'Starting audit...');

      // Create the audit graph with dependencies
      const graph = createAuditGraph({
        loadTransactions: async (ids: string[], year: number) => {
          return this.loadTransactions(ids, year);
        },
        saveResult: async (id: string, result: AuditResult) => {
          return this.saveResult(id, result);
        },
        updateProgress: async (id: string, progress: number, message: string) => {
          await this.auditRepository.updateStatus(id, 'PROCESSING', progress, message);
          await job.updateProgress(progress);
        },
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

  private async loadTransactions(walletIds: string[], taxYear: number): Promise<Transaction[]> {
    const startDate = new Date(taxYear, 0, 1);
    const endDate = new Date(taxYear, 11, 31, 23, 59, 59);

    const transactions = await this.transactionRepository.findByFilter({
      walletIds,
      startDate,
      endDate,
    });

    // Map database transactions to common Transaction type
    return transactions.map(tx => ({
      id: tx.id,
      walletId: tx.walletId,
      signature: tx.signature,
      type: tx.type as any,
      status: tx.status as any,
      timestamp: tx.timestamp,
      slot: tx.slot,
      blockTime: tx.blockTime,
      fee: tx.fee,
      feePayer: tx.feePayer,
      transfers: Array.isArray(tx.transfers) ? tx.transfers as any[] : [],
      totalValueUsd: tx.totalValueUsd ? Number(tx.totalValueUsd) : undefined,
      rawData: tx.rawData as Record<string, unknown>,
    }));
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
      metadata: result.metadata as any,
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
