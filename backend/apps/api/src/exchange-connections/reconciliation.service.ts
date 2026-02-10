import { Injectable, Logger } from '@nestjs/common';
import {
  ExchangeImportRepository,
  TransactionRepository,
  WalletRepository,
  PendingClassificationRepository,
  TokenSymbolMappingRepository,
  PrismaService,
} from '@auditswarm/database';

interface MatchCandidate {
  transactionId: string;
  score: number; // lower is better
  amountDiff: number;
  timeDiffMs: number;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const AMOUNT_TOLERANCE = 0.02; // 2% for fee variations

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private prisma: PrismaService,
    private importRepo: ExchangeImportRepository,
    private transactionRepo: TransactionRepository,
    private walletRepo: WalletRepository,
    private classificationRepo: PendingClassificationRepository,
    private tokenMappingRepo: TokenSymbolMappingRepository,
  ) {}

  /**
   * Reconcile exchange transactions from an import with on-chain transactions.
   * Legacy path: still matches ExchangeTransaction records from CSV imports.
   */
  async reconcileImport(importId: string, userId: string): Promise<{
    matched: number;
    unmatched: number;
    offRamps: number;
  }> {
    this.logger.log(`Starting reconciliation for import ${importId}`);

    const wallets = await this.walletRepo.findByUserId(userId);
    const walletIds = wallets.map(w => w.id);
    if (walletIds.length === 0) {
      this.logger.warn('No wallets found for user — cannot reconcile');
      return { matched: 0, unmatched: 0, offRamps: 0 };
    }

    const exchangeTxs = await this.importRepo.findTransactionsByImportId(importId, { take: 10000 });

    const exchangeDeposits = exchangeTxs.filter(t => t.type === 'DEPOSIT' && !(t.rawData as any)?.isFiatOrder);
    const exchangeWithdrawals = exchangeTxs.filter(t => t.type === 'WITHDRAWAL' && !(t.rawData as any)?.isFiatOrder);
    const exchangeSells = exchangeTxs.filter(t => t.type === 'TRADE' && t.side === 'SELL');

    let matched = 0;
    let offRamps = 0;

    for (const deposit of exchangeDeposits) {
      const match = await this.findOnChainMatch(
        walletIds, deposit.asset, Number(deposit.amount), deposit.timestamp,
        'TRANSFER_OUT', ONE_HOUR_MS, true,
        deposit.rawData,
      );

      if (match) {
        await this.prisma.exchangeTransaction.update({
          where: { id: deposit.id },
          data: { matchedTransactionId: match.transactionId, matchConfidence: 1 - match.score },
        });
        matched++;

        const sellAfterDeposit = exchangeSells.find(sell => {
          if (sell.asset !== deposit.asset) return false;
          const timeDiff = sell.timestamp.getTime() - deposit.timestamp.getTime();
          return timeDiff >= 0 && timeDiff < 24 * ONE_HOUR_MS;
        });

        if (sellAfterDeposit) {
          offRamps++;
          await this.classificationRepo.create({
            userId,
            transactionId: match.transactionId,
            type: 'OFFRAMP',
            status: 'PENDING',
            priority: 10,
            suggestedCategory: 'DISPOSAL_SALE',
            estimatedValueUsd: sellAfterDeposit.totalValueUsd ?? undefined,
            notes: `Off-ramp detected: sent to exchange, sold ${Number(sellAfterDeposit.amount)} ${sellAfterDeposit.asset}`,
          });
        }
      }
    }

    for (const withdrawal of exchangeWithdrawals) {
      const match = await this.findOnChainMatch(
        walletIds, withdrawal.asset, Number(withdrawal.amount), withdrawal.timestamp,
        'TRANSFER_IN', TWO_HOURS_MS, false,
        withdrawal.rawData,
      );

      if (match) {
        await this.prisma.exchangeTransaction.update({
          where: { id: withdrawal.id },
          data: { matchedTransactionId: match.transactionId, matchConfidence: 1 - match.score },
        });
        matched++;
      }
    }

    const unmatched = exchangeDeposits.length + exchangeWithdrawals.length - matched;

    await this.importRepo.updateStatus(importId, 'COMPLETED', {
      matchedRecords: matched,
      unmatchedRecords: unmatched,
    });

    this.logger.log(
      `Reconciliation complete: ${matched} matched, ${unmatched} unmatched, ${offRamps} off-ramps`,
    );

    return { matched, unmatched, offRamps };
  }

  /**
   * Reconcile unified Transaction records (API-sourced exchange data).
   * Uses linkedTransactionId for bidirectional linking.
   */
  async reconcileConnection(connectionId: string, userId: string): Promise<{
    matched: number;
    unmatched: number;
    offRamps: number;
  }> {
    this.logger.log(`Starting unified reconciliation for connection ${connectionId}`);

    const wallets = await this.walletRepo.findByUserId(userId);
    const walletIds = wallets.map(w => w.id);
    if (walletIds.length === 0) return { matched: 0, unmatched: 0, offRamps: 0 };

    // Exchange deposits/withdrawals not yet linked
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

    const exchangeSells = await this.prisma.transaction.findMany({
      where: {
        exchangeConnectionId: connectionId,
        type: { in: ['EXCHANGE_TRADE', 'EXCHANGE_FIAT_SELL'] },
      },
      select: { id: true, timestamp: true, totalValueUsd: true },
    });

    let matched = 0;
    let offRamps = 0;

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
        await this.prisma.$transaction([
          this.prisma.transaction.update({
            where: { id: deposit.id },
            data: { linkedTransactionId: match.transactionId },
          }),
          this.prisma.transaction.update({
            where: { id: match.transactionId },
            data: { linkedTransactionId: deposit.id },
          }),
        ]);
        matched++;

        const sellAfter = exchangeSells.find(s => {
          const diff = s.timestamp.getTime() - deposit.timestamp.getTime();
          return diff >= 0 && diff < 24 * ONE_HOUR_MS;
        });

        if (sellAfter) {
          offRamps++;
          await this.classificationRepo.create({
            userId,
            transactionId: match.transactionId,
            type: 'OFFRAMP',
            status: 'PENDING',
            priority: 10,
            suggestedCategory: 'DISPOSAL_SALE',
            estimatedValueUsd: sellAfter.totalValueUsd ?? undefined,
            notes: `Off-ramp: exchange deposit followed by sell within 24h`,
          });
        }
      }
    }

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
            data: { linkedTransactionId: match.transactionId },
          }),
          this.prisma.transaction.update({
            where: { id: match.transactionId },
            data: { linkedTransactionId: withdrawal.id },
          }),
        ]);
        matched++;
      }
    }

    const total = exchangeDeposits.length + exchangeWithdrawals.length;
    this.logger.log(
      `Unified reconciliation: ${matched} matched, ${total - matched} unmatched, ${offRamps} off-ramps`,
    );

    return { matched, unmatched: total - matched, offRamps };
  }

  private async findOnChainMatch(
    walletIds: string[], asset: string, amount: number, exchangeTimestamp: Date,
    onChainType: string, timeWindowMs: number, onChainBefore: boolean,
    rawData?: any,
  ): Promise<MatchCandidate | null> {
    // Strategy 1: Direct txId match (exchange deposits/withdrawals often have the on-chain signature)
    const txId = rawData?.txId;
    if (txId) {
      const directMatch = await this.transactionRepo.findBySignature(txId);
      if (directMatch && !(directMatch as any).linkedTransactionId) {
        return { transactionId: directMatch.id, score: 0, amountDiff: 0, timeDiffMs: 0 };
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

    const matches: MatchCandidate[] = [];

    for (const tx of candidates) {
      if ((tx as any).linkedTransactionId) continue;

      const transfers = (tx.transfers as any[]) ?? [];
      for (const transfer of transfers) {
        const tMint = transfer.mint ?? '';
        if (tMint !== targetMint) continue;

        const transferAmount = Math.abs(transfer.amount ?? 0);
        const amountDiff = Math.abs(transferAmount - amount) / Math.max(amount, 0.0001);
        if (amountDiff > AMOUNT_TOLERANCE) continue;

        const timeDiffMs = Math.abs(tx.timestamp.getTime() - exchangeTimestamp.getTime());
        const score = amountDiff * 0.7 + (timeDiffMs / timeWindowMs) * 0.3;

        matches.push({ transactionId: tx.id, score, amountDiff, timeDiffMs });
      }
    }

    if (matches.length === 0) return null;
    matches.sort((a, b) => a.score - b.score);
    return matches[0];
  }
}
