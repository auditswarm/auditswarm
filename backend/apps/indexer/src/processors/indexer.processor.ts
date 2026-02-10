import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  QUEUES,
  JOB_NAMES,
  IndexerJobData,
  IndexTransactionJobData,
  SyncWalletJobData,
  RegisterWebhookJobData,
  DetectFundingSourceJobData,
  ClassifyTransactionsJobData,
  RecalculateTaxLotsJobData,
  AnalyzeCounterpartiesJobData,
  ProcessExchangeImportJobData,
  SyncExchangeConnectionJobData,
  SyncExchangePhaseJobData,
  ReconcileExchangeJobData,
} from '@auditswarm/queue';
import {
  TransactionRepository,
  TransactionEnrichmentRepository,
  TransactionFlowRepository,
  WalletRepository,
} from '@auditswarm/database';
import { BackfillService } from '../services/backfill.service';
import { TransactionParserService } from '../services/transaction-parser.service';
import { TokenMetadataService } from '../services/token-metadata.service';
import { PriceService } from '../services/price.service';
import { CounterpartyService } from '../services/counterparty.service';
import { WebhookManagerService } from '../services/webhook-manager.service';
import { FundingSourceService } from '../services/funding-source.service';
import { ClassificationService } from '../services/classification.service';
import { TaxLotCalculatorService } from '../services/tax-lot-calculator.service';
import { CounterpartyAnalysisService } from '../services/counterparty-analysis.service';
import { ExchangeSyncService } from '../services/exchange-sync.service';
import type { Prisma } from '@prisma/client';

@Processor(QUEUES.INDEXER, { concurrency: 5 })
export class IndexerProcessor extends WorkerHost {
  private readonly logger = new Logger(IndexerProcessor.name);

  constructor(
    private backfillService: BackfillService,
    private parser: TransactionParserService,
    private tokenMetadata: TokenMetadataService,
    private priceService: PriceService,
    private counterpartyService: CounterpartyService,
    private webhookManager: WebhookManagerService,
    private fundingSourceService: FundingSourceService,
    private classificationService: ClassificationService,
    private taxLotCalculator: TaxLotCalculatorService,
    private counterpartyAnalysis: CounterpartyAnalysisService,
    private exchangeSyncService: ExchangeSyncService,
    private transactionRepo: TransactionRepository,
    private enrichmentRepo: TransactionEnrichmentRepository,
    private flowRepo: TransactionFlowRepository,
    private walletRepo: WalletRepository,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case JOB_NAMES.INDEX_WALLET:
        return this.handleIndexWallet(job as Job<IndexerJobData>);
      case JOB_NAMES.INDEX_TRANSACTION:
        return this.handleIndexTransaction(job as Job<IndexTransactionJobData>);
      case JOB_NAMES.SYNC_WALLET:
        return this.handleSyncWallet(job as Job<SyncWalletJobData>);
      case JOB_NAMES.REGISTER_WEBHOOK:
        return this.handleRegisterWebhook(job as Job<RegisterWebhookJobData>);
      case JOB_NAMES.DETECT_FUNDING_SOURCE:
        return this.handleDetectFundingSource(job as Job<DetectFundingSourceJobData>);
      case JOB_NAMES.CLASSIFY_TRANSACTIONS:
        return this.handleClassifyTransactions(job as Job<ClassifyTransactionsJobData>);
      case JOB_NAMES.RECALCULATE_TAX_LOTS:
        return this.handleRecalculateTaxLots(job as Job<RecalculateTaxLotsJobData>);
      case JOB_NAMES.ANALYZE_COUNTERPARTIES:
        return this.handleAnalyzeCounterparties(job as Job<AnalyzeCounterpartiesJobData>);
      case JOB_NAMES.PROCESS_EXCHANGE_IMPORT:
        return this.handleProcessExchangeImport(job as Job<ProcessExchangeImportJobData>);
      case JOB_NAMES.SYNC_EXCHANGE_CONNECTION:
        return this.handleSyncExchangeConnection(job as Job<SyncExchangeConnectionJobData>);
      case JOB_NAMES.SYNC_EXCHANGE_PHASE:
        return this.handleSyncExchangePhase(job as Job<SyncExchangePhaseJobData>);
      case JOB_NAMES.RECONCILE_EXCHANGE:
        return this.handleReconcileExchange(job as Job<ReconcileExchangeJobData>);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async handleIndexWallet(job: Job<IndexerJobData>): Promise<void> {
    const { walletId, walletAddress, fromSignature } = job.data;
    this.logger.log(`Backfilling wallet ${walletId} (${walletAddress})`);
    await this.backfillService.backfillWallet(walletId, walletAddress, fromSignature);
  }

  private async handleIndexTransaction(job: Job<IndexTransactionJobData>): Promise<void> {
    const { walletAddress, walletId, enrichedTransactions, source } = job.data;
    this.logger.log(`Processing ${enrichedTransactions.length} ${source} transactions for ${walletAddress}`);

    // Find wallet ID if not provided
    let resolvedWalletId = walletId;
    if (!resolvedWalletId) {
      const wallet = await this.walletRepo.findByAddress(walletAddress);
      if (!wallet) {
        this.logger.warn(`No wallet found for address ${walletAddress}, skipping`);
        return;
      }
      resolvedWalletId = wallet.id;
    }

    const transactions: Prisma.TransactionCreateManyInput[] = [];
    const enrichments: Prisma.TransactionEnrichmentCreateManyInput[] = [];
    const flowInputs: { txId: string; type: string; totalValueUsd: number; rawData: any; fee: bigint; feePayer: string }[] = [];

    for (const heliusTx of enrichedTransactions) {
      const parsed = this.parser.parse(heliusTx, walletAddress);
      if (!parsed) continue;

      // Resolve metadata
      if (parsed.involvedMints.length > 0) {
        await this.tokenMetadata.ensureMetadata(parsed.involvedMints);
      }

      // Get prices
      let totalValueUsd = 0;
      for (const transfer of parsed.transaction.transfers) {
        const value = await this.priceService.getTransferValue(
          transfer.mint,
          transfer.amount,
          parsed.transaction.blockTime,
        );
        if (value !== null) totalValueUsd += Math.abs(value);
      }

      const txId = crypto.randomUUID();
      transactions.push({
        id: txId,
        walletId: resolvedWalletId,
        signature: parsed.transaction.signature,
        type: parsed.transaction.type,
        status: parsed.transaction.status,
        timestamp: parsed.transaction.timestamp,
        slot: BigInt(parsed.transaction.slot),
        blockTime: BigInt(parsed.transaction.blockTime),
        fee: parsed.transaction.fee,
        feePayer: parsed.transaction.feePayer,
        totalValueUsd: totalValueUsd > 0 ? totalValueUsd : undefined,
        transfers: parsed.transaction.transfers as any,
        rawData: parsed.transaction.rawData,
      });

      // Track for flow extraction
      flowInputs.push({
        txId,
        type: parsed.transaction.type,
        totalValueUsd: totalValueUsd > 0 ? totalValueUsd : 0,
        rawData: parsed.transaction.rawData,
        fee: parsed.transaction.fee,
        feePayer: parsed.transaction.feePayer,
      });

      enrichments.push({
        id: crypto.randomUUID(),
        transactionId: txId,
        protocolName: parsed.enrichment.protocolName,
        protocolProgramId: parsed.enrichment.protocolProgramId,
        heliusType: parsed.enrichment.heliusType,
        heliusSource: parsed.enrichment.heliusSource,
        swapDetails: parsed.enrichment.swapDetails,
        stakingDetails: parsed.enrichment.stakingDetails,
        defiDetails: parsed.enrichment.defiDetails,
        isUnknown: parsed.enrichment.isUnknown,
        isFailed: parsed.enrichment.isFailed,
      });

      // Process counterparties
      await this.counterpartyService.processTransaction(
        resolvedWalletId,
        parsed.involvedAddresses,
        parsed.transaction.timestamp,
        totalValueUsd > 0 ? totalValueUsd : undefined,
      );
    }

    if (transactions.length > 0) {
      await this.transactionRepo.createMany(transactions);
      await this.enrichmentRepo.createMany(enrichments);

      // Extract and insert TransactionFlow records
      const flows: Prisma.TransactionFlowCreateManyInput[] = [];
      for (const fi of flowInputs) {
        const extracted = BackfillService.extractFlows(
          fi.txId,
          resolvedWalletId,
          walletAddress,
          fi.rawData,
          fi.type,
          fi.totalValueUsd,
          fi.fee,
          fi.feePayer,
        );
        flows.push(...extracted);
      }
      if (flows.length > 0) {
        await this.flowRepo.createMany(flows);
      }

      // Update wallet stats (absolute count from DB)
      const txCount = await this.transactionRepo.countByWalletId(resolvedWalletId);
      const latestTx = transactions.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      )[0];
      await this.walletRepo.updateTransactionStats(
        resolvedWalletId,
        new Date(latestTx.timestamp),
        txCount,
      );
    }

    this.logger.log(`Indexed ${transactions.length} transactions (${flowInputs.length} flows) for ${walletAddress}`);
  }

  private async handleSyncWallet(job: Job<SyncWalletJobData>): Promise<void> {
    const { walletId, walletAddress, reason } = job.data;
    this.logger.log(`Syncing wallet ${walletId} (reason: ${reason})`);

    if (reason === 'reclassify') {
      await this.counterpartyService.reclassifyForNewWallet(walletId, walletAddress);
    }
  }

  private async handleRegisterWebhook(job: Job<RegisterWebhookJobData>): Promise<void> {
    const { walletAddress, action } = job.data;
    this.logger.log(`Webhook ${action} for ${walletAddress}`);

    if (action === 'add') {
      await this.webhookManager.registerAddress(walletAddress);
    } else {
      await this.webhookManager.unregisterAddress(walletAddress);
    }
  }

  private async handleDetectFundingSource(job: Job<DetectFundingSourceJobData>): Promise<void> {
    const { walletId, walletAddress } = job.data;
    this.logger.log(`Detecting funding source for wallet ${walletId}`);
    await this.fundingSourceService.detectFundingSource(walletId, walletAddress);
  }

  private async handleClassifyTransactions(job: Job<ClassifyTransactionsJobData>): Promise<void> {
    const { walletId, walletAddress, userId } = job.data;
    this.logger.log(`Classifying transactions for wallet ${walletId}`);
    await this.classificationService.classifyWalletTransactions(walletId, walletAddress, userId);
  }

  private async handleRecalculateTaxLots(job: Job<RecalculateTaxLotsJobData>): Promise<void> {
    const { userId, taxYear } = job.data;
    this.logger.log(`Recalculating tax lots for user ${userId}`);
    await this.taxLotCalculator.computeAllMethods(userId, taxYear);
  }

  private async handleAnalyzeCounterparties(job: Job<AnalyzeCounterpartiesJobData>): Promise<void> {
    const { userId, walletId, counterpartyIds } = job.data;
    this.logger.log(`Analyzing counterparties for wallet ${walletId}`);
    await this.counterpartyAnalysis.analyzeCounterparties(userId, walletId, counterpartyIds);
  }

  private async handleProcessExchangeImport(job: Job<ProcessExchangeImportJobData>): Promise<void> {
    const { importId } = job.data;
    this.logger.log(`Processing exchange import ${importId}`);
  }

  private async handleSyncExchangeConnection(job: Job<SyncExchangeConnectionJobData>): Promise<void> {
    const { connectionId, userId, fullSync } = job.data;
    this.logger.log(`Syncing exchange connection ${connectionId}`);
    await this.exchangeSyncService.syncConnection(connectionId, userId, fullSync ?? false);
  }

  private async handleSyncExchangePhase(job: Job<SyncExchangePhaseJobData>): Promise<void> {
    const { connectionId, userId, phase, fullSync } = job.data;
    this.logger.log(`Syncing exchange phase ${phase} for connection ${connectionId}`);
    await this.exchangeSyncService.syncPhase(connectionId, userId, phase, fullSync);
  }

  private async handleReconcileExchange(job: Job<ReconcileExchangeJobData>): Promise<void> {
    const { importId, userId } = job.data;
    this.logger.log(`Reconciling exchange import ${importId}`);
    // Reconciliation is now handled by the sync service's reconcileUnified method
    // or by the ReconciliationService for CSV imports
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`Job ${job.id} (${job.name}) started`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} (${job.name}) completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} (${job.name}) failed: ${error.message}`);
  }
}
