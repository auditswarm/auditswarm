import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import {
  WalletSyncStateRepository,
  TransactionRepository,
  TransactionEnrichmentRepository,
  TransactionFlowRepository,
  WalletRepository,
} from '@auditswarm/database';
import { QUEUES, JOB_NAMES } from '@auditswarm/queue';
import { HeliusService } from './helius.service';
import { TransactionParserService } from './transaction-parser.service';
import { TokenMetadataService } from './token-metadata.service';
import { PriceService } from './price.service';
import { CounterpartyService } from './counterparty.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);
  private readonly batchSize: number;

  constructor(
    private heliusService: HeliusService,
    private parser: TransactionParserService,
    private tokenMetadata: TokenMetadataService,
    private priceService: PriceService,
    private counterpartyService: CounterpartyService,
    private syncStateRepo: WalletSyncStateRepository,
    private transactionRepo: TransactionRepository,
    private enrichmentRepo: TransactionEnrichmentRepository,
    private flowRepo: TransactionFlowRepository,
    private walletRepo: WalletRepository,
    private configService: ConfigService,
    @InjectQueue(QUEUES.INDEXER) private indexerQueue: Queue,
  ) {
    this.batchSize = this.configService.get<number>('indexer.batchSize', 100);
  }

  async backfillWallet(
    walletId: string,
    walletAddress: string,
    fromSignature?: string,
  ): Promise<void> {
    this.logger.log(`Starting backfill for wallet ${walletId} (${walletAddress})`);

    // 1. Initialize sync state
    const existingSyncState = await this.syncStateRepo.findByWalletId(walletId);
    await this.syncStateRepo.upsert(walletId, { status: 'SYNCING' });

    // Resume from cursor if available
    let cursor = fromSignature ?? existingSyncState?.lastSignature ?? undefined;
    let totalFound = existingSyncState?.totalTransactionsFound ?? 0;
    let totalIndexed = existingSyncState?.totalTransactionsIndexed ?? 0;

    try {
      // 2. Fetch all transactions page by page
      let hasMore = true;

      while (hasMore) {
        // Fetch enhanced transactions from Helius
        const enhancedTxs = await this.heliusService.getEnhancedTransactions(walletAddress, {
          limit: this.batchSize,
          before: cursor,
        });

        if (!enhancedTxs || enhancedTxs.length === 0) {
          hasMore = false;
          break;
        }

        totalFound += enhancedTxs.length;

        // Process batch
        const { txCount, lastSig } = await this.processBatch(
          enhancedTxs,
          walletId,
          walletAddress,
        );

        totalIndexed += txCount;
        cursor = lastSig;

        // Update progress
        const progress = Math.min(
          99, // Reserve 100 for COMPLETED
          Math.floor((totalIndexed / Math.max(totalFound, 1)) * 100),
        );

        await this.syncStateRepo.updateProgress(
          walletId,
          cursor,
          progress,
          totalFound,
          totalIndexed,
        );

        // If we got fewer than batchSize, we've reached the end
        if (enhancedTxs.length < this.batchSize) {
          hasMore = false;
        }
      }

      // 3. Mark as completed
      await this.syncStateRepo.upsert(walletId, {
        status: 'COMPLETED',
        progress: 100,
        oldestSignature: cursor,
      });

      // Update wallet transaction stats (absolute count from DB)
      const txCount = await this.transactionRepo.countByWalletId(walletId);
      const latestTx = await this.transactionRepo.findByWalletId(walletId, {
        take: 1,
        orderBy: 'desc',
      });
      if (latestTx.length > 0) {
        await this.walletRepo.updateTransactionStats(
          walletId,
          latestTx[0].timestamp,
          txCount,
        );
      }

      this.logger.log(
        `Backfill completed for wallet ${walletId}: ${totalIndexed} transactions indexed`,
      );

      // Dispatch post-sync jobs
      const wallet = await this.walletRepo.findById(walletId);
      const userId = wallet?.userId;
      if (userId) {
        // 1. Detect funding source (only on first sync)
        await this.indexerQueue.add(
          JOB_NAMES.DETECT_FUNDING_SOURCE,
          { walletId, walletAddress, userId },
          { jobId: `funding-${walletId}`, priority: 5 },
        );

        // 2. Classify transactions
        await this.indexerQueue.add(
          JOB_NAMES.CLASSIFY_TRANSACTIONS,
          { walletId, walletAddress, userId },
          { jobId: `classify-${walletId}-${Date.now()}`, priority: 7 },
        );

        // 3. Recalculate tax lots (debounced per user)
        await this.indexerQueue.add(
          JOB_NAMES.RECALCULATE_TAX_LOTS,
          { userId, triggerWalletId: walletId },
          { jobId: `tax-lots-${userId}`, priority: 3, delay: 5000 },
        );

        // 4. Analyze unknown counterparties
        await this.indexerQueue.add(
          JOB_NAMES.ANALYZE_COUNTERPARTIES,
          { userId, walletId, counterpartyIds: [] },
          { jobId: `analyze-cp-${walletId}-${Date.now()}`, priority: 1 },
        );
      }
    } catch (error) {
      this.logger.error(`Backfill failed for wallet ${walletId}: ${error}`);

      // Save cursor for resume
      await this.syncStateRepo.setError(
        walletId,
        error instanceof Error ? error.message : 'Unknown error',
      );

      throw error;
    }
  }

  private static readonly SOL_MINT = 'So11111111111111111111111111111111111111112';
  private static readonly SOL_DECIMALS = 9;

  private async processBatch(
    enhancedTxs: any[],
    walletId: string,
    walletAddress: string,
  ): Promise<{ txCount: number; lastSig: string }> {
    const transactions: Prisma.TransactionCreateManyInput[] = [];
    const enrichments: Prisma.TransactionEnrichmentCreateManyInput[] = [];
    const flowInputs: { txId: string; type: string; totalValueUsd: number; rawData: any; fee: bigint; feePayer: string }[] = [];
    let lastSig = '';

    for (const heliusTx of enhancedTxs) {
      const parsed = this.parser.parse(heliusTx, walletAddress);
      if (!parsed) continue;

      lastSig = parsed.transaction.signature;

      // Resolve token metadata
      if (parsed.involvedMints.length > 0) {
        await this.tokenMetadata.ensureMetadata(parsed.involvedMints);
      }

      // Get prices for transfers — only wallet-relevant ones
      const blockTime = parsed.transaction.blockTime;
      const walletAddr = walletAddress.toLowerCase();
      const totalValueUsd = await this.calculateTotalValue(
        parsed.transaction.transfers,
        parsed.transaction.type,
        walletAddr,
        blockTime,
      );

      // Build transaction record
      const txId = crypto.randomUUID();
      transactions.push({
        id: txId,
        walletId,
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

      // Build enrichment record
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

      // Process counterparties — skip only if we KNOW the value and it's dust
      if (parsed.involvedAddresses.length > 0 && (totalValueUsd >= 0.01 || totalValueUsd === 0)) {
        await this.counterpartyService.processTransaction(
          walletId,
          parsed.involvedAddresses,
          parsed.transaction.timestamp,
          totalValueUsd > 0 ? totalValueUsd : undefined,
        );
      }
    }

    // Filter out transactions whose signature already exists in DB
    if (transactions.length > 0) {
      const signatures = transactions.map(t => t.signature).filter((s): s is string => s != null);
      const existing = await this.transactionRepo.findExistingSignatures(signatures);
      const existingSet = new Set(existing);

      const newTxs = transactions.filter(t => !t.signature || !existingSet.has(t.signature));
      const newTxIds = new Set(newTxs.map(t => t.id));
      const newEnrichments = enrichments.filter(e => newTxIds.has(e.transactionId));

      if (newTxs.length > 0) {
        await this.transactionRepo.createMany(newTxs);
        await this.enrichmentRepo.createMany(newEnrichments);

        // Extract and insert TransactionFlow records for new transactions
        const flows: Prisma.TransactionFlowCreateManyInput[] = [];
        for (const fi of flowInputs) {
          if (!newTxIds.has(fi.txId)) continue;
          const extracted = BackfillService.extractFlows(
            fi.txId,
            walletId,
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
      }
    }

    return {
      txCount: transactions.length,
      lastSig: lastSig || enhancedTxs[enhancedTxs.length - 1]?.signature || '',
    };
  }

  /**
   * Extract TransactionFlow records from rawData.accountData.
   * Uses the authoritative accountData for lossless precision.
   * Public static so webhook handler and reconciliation can reuse.
   */
  static extractFlows(
    txId: string,
    walletId: string,
    walletAddress: string,
    rawData: any,
    txType: string,
    totalValueUsd: number,
    fee: bigint,
    feePayer: string,
  ): Prisma.TransactionFlowCreateManyInput[] {
    const flows: Prisma.TransactionFlowCreateManyInput[] = [];
    const accountData: any[] = rawData?.accountData;
    if (!accountData?.length) return flows;

    const walletAddr = walletAddress.toLowerCase();

    // SOL flow
    for (const ad of accountData) {
      if ((ad.account ?? '').toLowerCase() !== walletAddr) continue;

      // Use raw nativeBalanceChange — includes fee deductions, matches on-chain balance
      const solDeltaLamports = BigInt(Math.round(ad.nativeBalanceChange ?? 0));

      if (solDeltaLamports !== 0n) {
        const absLamports = solDeltaLamports < 0n ? -solDeltaLamports : solDeltaLamports;
        const direction = solDeltaLamports > 0n ? 'IN' : 'OUT';
        const humanAmount = new Prisma.Decimal(absLamports.toString()).div(
          new Prisma.Decimal(10).pow(BackfillService.SOL_DECIMALS),
        );

        flows.push({
          id: crypto.randomUUID(),
          transactionId: txId,
          walletId,
          mint: BackfillService.SOL_MINT,
          decimals: BackfillService.SOL_DECIMALS,
          rawAmount: absLamports.toString(),
          amount: humanAmount,
          direction,
          valueUsd: null,
        });
      }
      break;
    }

    // SPL token flows
    for (const ad of accountData) {
      for (const tbc of ad.tokenBalanceChanges ?? []) {
        if ((tbc.userAccount ?? '').toLowerCase() !== walletAddr) continue;

        const mint: string = tbc.mint ?? '';
        if (!mint) continue;

        const rawStr: string = tbc.rawTokenAmount?.tokenAmount ?? '0';
        const decimals: number = tbc.rawTokenAmount?.decimals ?? 0;

        let rawDelta: bigint;
        try {
          rawDelta = BigInt(rawStr);
        } catch {
          continue;
        }
        if (rawDelta === 0n) continue;

        const absRaw = rawDelta < 0n ? -rawDelta : rawDelta;
        const direction = rawDelta > 0n ? 'IN' : 'OUT';
        const humanAmount = new Prisma.Decimal(absRaw.toString()).div(
          new Prisma.Decimal(10).pow(decimals),
        );

        flows.push({
          id: crypto.randomUUID(),
          transactionId: txId,
          walletId,
          mint,
          decimals,
          rawAmount: absRaw.toString(),
          amount: humanAmount,
          direction,
          valueUsd: null,
        });
      }
    }

    // USD attribution
    if (flows.length > 0 && totalValueUsd > 0) {
      BackfillService.attributeUsd(flows, txType, totalValueUsd);
    }

    return flows;
  }

  static attributeUsd(
    flows: Prisma.TransactionFlowCreateManyInput[],
    txType: string,
    totalValueUsd: number,
  ): void {
    const stableFlow = flows.find(f => BackfillService.STABLECOIN_MINTS.has(f.mint));

    if (txType === 'SWAP') {
      if (stableFlow) {
        const stableAmount = Number((stableFlow.amount as Prisma.Decimal).toString());
        for (const f of flows) {
          if (BackfillService.STABLECOIN_MINTS.has(f.mint)) {
            f.valueUsd = new Prisma.Decimal(Number((f.amount as Prisma.Decimal).toString()).toFixed(8));
          } else {
            f.valueUsd = new Prisma.Decimal(stableAmount.toFixed(8));
          }
        }
      } else {
        for (const f of flows) {
          f.valueUsd = new Prisma.Decimal(totalValueUsd.toFixed(8));
        }
      }
    } else {
      for (const f of flows) {
        f.valueUsd = new Prisma.Decimal(totalValueUsd.toFixed(8));
      }
    }
  }

  private static readonly STABLECOIN_MINTS = new Set([
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  ]);

  /**
   * Calculate totalValueUsd smartly:
   * 1. Filter to wallet-relevant transfers (wallet address in from/to/userAccount)
   * 2. For SWAPs with wallet-relevant transfers: max(IN, OUT) to avoid double-counting
   * 3. For SWAPs without wallet-relevant (PumpAMM multi-hop):
   *    a. If stablecoin present: use deduplicated stablecoin amount (= USD value)
   *    b. Otherwise: deduplicate by mint, price unique amounts, take max
   * 4. For non-swaps: sum wallet-relevant transfer values
   */
  private async calculateTotalValue(
    transfers: { mint: string; amount: number; direction: 'IN' | 'OUT'; from: string; to: string; fromUserAccount?: string; toUserAccount?: string }[],
    txType: string,
    walletAddr: string,
    blockTime: number,
  ): Promise<number> {
    // Filter to wallet-relevant transfers only
    const relevant = transfers.filter(t => {
      const addrs = [t.from, t.to, t.fromUserAccount, t.toUserAccount]
        .filter(Boolean)
        .map(a => a!.toLowerCase());
      return addrs.includes(walletAddr);
    });

    if (txType === 'SWAP') {
      // Fast path: if swap involves USDC/USDT, use stablecoin amount directly (= USD value, no Birdeye needed)
      const stableTransfers = transfers.filter(t => BackfillService.STABLECOIN_MINTS.has(t.mint));
      if (stableTransfers.length > 0) {
        const uniqueAmounts = new Set(stableTransfers.map(t => t.amount));
        let total = 0;
        for (const amt of uniqueAmounts) total += amt;
        return total;
      }

      if (relevant.length > 0) {
        // Wallet-relevant swap without stablecoin: max(IN, OUT) to count only one side
        let inValue = 0;
        let outValue = 0;
        for (const t of relevant) {
          const v = await this.priceService.getTransferValue(t.mint, t.amount, blockTime);
          if (v === null) continue;
          if (t.direction === 'IN') inValue += Math.abs(v);
          else outValue += Math.abs(v);
        }
        return Math.max(inValue, outValue);
      }

      // Fallback: no wallet-relevant transfers, no stablecoin (PumpAMM multi-hop via ATAs)
      // Deduplicate by mint, price unique amounts, take max
      const byMint = new Map<string, number>();
      for (const t of transfers) {
        byMint.set(t.mint, Math.max(byMint.get(t.mint) ?? 0, t.amount));
      }
      let maxValue = 0;
      for (const [mint, amount] of byMint) {
        const v = await this.priceService.getTransferValue(mint, amount, blockTime);
        if (v !== null) maxValue = Math.max(maxValue, Math.abs(v));
      }
      return maxValue;
    }

    // Non-swap: sum wallet-relevant transfers (or all if none match)
    const toPrice = relevant.length > 0 ? relevant : transfers;
    let total = 0;
    for (const t of toPrice) {
      const v = await this.priceService.getTransferValue(t.mint, t.amount, blockTime);
      if (v !== null) total += Math.abs(v);
    }
    return total;
  }
}
