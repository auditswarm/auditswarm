import { Injectable, Logger } from '@nestjs/common';
import {
  WalletRepository,
  PortfolioSnapshotRepository,
  TransactionFlowRepository,
  PrismaService,
} from '@auditswarm/database';
import { Prisma } from '@prisma/client';

interface TaxLot {
  amount: number;
  costBasisPerUnit: number;
  acquiredAt: Date;
}

interface MintResult {
  totalAcquired: number;
  totalDisposed: number;
  totalCostBasis: number;
  totalProceeds: number;
  realizedGainLoss: number;
  shortTermGainLoss: number;
  longTermGainLoss: number;
  remainingAmount: number;
  holdingsCount: number;
}

const METHODS = ['FIFO', 'LIFO', 'WAC'] as const;
const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

@Injectable()
export class TaxLotCalculatorService {
  private readonly logger = new Logger(TaxLotCalculatorService.name);

  constructor(
    private walletRepo: WalletRepository,
    private snapshotRepo: PortfolioSnapshotRepository,
    private flowRepo: TransactionFlowRepository,
    private prisma: PrismaService,
  ) {}

  async computeAllMethods(
    userId: string,
    taxYear?: number,
  ): Promise<void> {
    this.logger.log(`Computing tax lots for user ${userId}, taxYear=${taxYear ?? 'all'}`);

    // 1. Get all user wallet IDs for unified portfolio
    const wallets = await this.walletRepo.findByUserId(userId);
    const walletIds = wallets.map(w => w.id);
    const walletAddresses = new Set(wallets.map(w => w.address.toLowerCase()));

    if (walletIds.length === 0) {
      this.logger.debug(`No wallets for user ${userId}`);
      return;
    }

    // 2. Mark existing snapshots as stale
    await this.snapshotRepo.markStale(userId);

    // 3. Fetch ALL flows ordered by timestamp ASC (raw SQL for join)
    const flows = await this.fetchOrderedFlows(walletIds);

    if (flows.length === 0) {
      this.logger.debug(`No flows for user ${userId}`);
      return;
    }

    // 4. Group flows by mint
    const flowsByMint = new Map<string, typeof flows>();
    for (const flow of flows) {
      const mint = flow.mint;
      if (!flowsByMint.has(mint)) flowsByMint.set(mint, []);
      flowsByMint.get(mint)!.push(flow);
    }

    // 5. Compute for each method and each mint
    for (const method of METHODS) {
      for (const [mint, mintFlows] of flowsByMint) {
        // Filter internal transfers (both wallets belong to user)
        const externalFlows = this.filterInternalTransfers(mintFlows, walletAddresses);
        if (externalFlows.length === 0) continue;

        // Group by tax year
        const byYear = new Map<number, typeof externalFlows>();
        for (const flow of externalFlows) {
          const year = flow.timestamp.getFullYear();
          const targetYear = taxYear ?? year;
          if (taxYear && year !== taxYear) continue;
          if (!byYear.has(targetYear)) byYear.set(targetYear, []);
          byYear.get(targetYear)!.push(flow);
        }

        // If no tax year filter, compute across all years with a single lot pool
        if (!taxYear) {
          const result = this.computeForMint(externalFlows, method);
          const year = externalFlows[externalFlows.length - 1].timestamp.getFullYear();
          await this.saveSnapshot(userId, mint, method, year, result);
        } else {
          for (const [year, yearFlows] of byYear) {
            const result = this.computeForMint(yearFlows, method);
            await this.saveSnapshot(userId, mint, method, year, result);
          }
        }
      }
    }

    this.logger.log(`Tax lot computation complete for user ${userId}`);
  }

  private computeForMint(
    flows: FlowRecord[],
    method: typeof METHODS[number],
  ): MintResult {
    const lots: TaxLot[] = [];
    let totalAcquired = 0;
    let totalDisposed = 0;
    let totalCostBasis = 0;
    let totalProceeds = 0;
    let realizedGainLoss = 0;
    let shortTermGainLoss = 0;
    let longTermGainLoss = 0;

    for (const flow of flows) {
      const amount = Number(flow.amount);
      const valueUsd = flow.valueUsd ? Number(flow.valueUsd) : 0;

      if (flow.direction === 'IN') {
        // Acquisition — create tax lot
        const costBasisPerUnit = amount > 0 ? valueUsd / amount : 0;
        lots.push({ amount, costBasisPerUnit, acquiredAt: flow.timestamp });
        totalAcquired += amount;
        totalCostBasis += valueUsd;
      } else {
        // Disposition — match against lots
        let remaining = amount;
        const proceeds = valueUsd;
        totalDisposed += amount;
        totalProceeds += proceeds;

        const proceedsPerUnit = amount > 0 ? proceeds / amount : 0;

        while (remaining > 0 && lots.length > 0) {
          const lotIndex = this.getLotIndex(lots, method);
          const lot = lots[lotIndex];
          const matched = Math.min(remaining, lot.amount);
          const matchedCostBasis = matched * lot.costBasisPerUnit;
          const matchedProceeds = matched * proceedsPerUnit;
          const gainLoss = matchedProceeds - matchedCostBasis;

          realizedGainLoss += gainLoss;

          // Short-term vs long-term
          const holdingPeriodMs = flow.timestamp.getTime() - lot.acquiredAt.getTime();
          if (holdingPeriodMs > ONE_YEAR_MS) {
            longTermGainLoss += gainLoss;
          } else {
            shortTermGainLoss += gainLoss;
          }

          lot.amount -= matched;
          remaining -= matched;

          if (lot.amount <= 0.000000001) {
            lots.splice(lotIndex, 1);
          }
        }
      }
    }

    // WAC: recalculate cost basis using weighted average
    if (method === 'WAC' && lots.length > 0) {
      const totalRemainingCost = lots.reduce((s, l) => s + l.amount * l.costBasisPerUnit, 0);
      const totalRemainingAmount = lots.reduce((s, l) => s + l.amount, 0);
      const wac = totalRemainingAmount > 0 ? totalRemainingCost / totalRemainingAmount : 0;
      for (const lot of lots) {
        lot.costBasisPerUnit = wac;
      }
    }

    const remainingAmount = lots.reduce((s, l) => s + l.amount, 0);
    const unrealizedCostBasis = lots.reduce((s, l) => s + l.amount * l.costBasisPerUnit, 0);

    return {
      totalAcquired,
      totalDisposed,
      totalCostBasis,
      totalProceeds,
      realizedGainLoss,
      shortTermGainLoss,
      longTermGainLoss,
      remainingAmount,
      holdingsCount: lots.length,
    };
  }

  private getLotIndex(lots: TaxLot[], method: typeof METHODS[number]): number {
    switch (method) {
      case 'FIFO':
        return 0; // First in
      case 'LIFO':
        return lots.length - 1; // Last in
      case 'WAC':
        return 0; // WAC uses first lot (all lots have same cost basis after averaging)
    }
  }

  private filterInternalTransfers(
    flows: FlowRecord[],
    userAddresses: Set<string>,
  ): FlowRecord[] {
    // Group flows by transactionId — if a transaction has flows in 2+ user wallets,
    // it's an internal transfer and should be excluded
    const txFlows = new Map<string, FlowRecord[]>();
    for (const flow of flows) {
      if (!txFlows.has(flow.transactionId)) txFlows.set(flow.transactionId, []);
      txFlows.get(flow.transactionId)!.push(flow);
    }

    const result: FlowRecord[] = [];
    for (const [txId, group] of txFlows) {
      const uniqueWallets = new Set(group.map(f => f.walletId));
      if (uniqueWallets.size > 1) continue; // Internal transfer — skip
      result.push(...group);
    }
    return result;
  }

  private async fetchOrderedFlows(walletIds: string[]): Promise<FlowRecord[]> {
    if (walletIds.length === 0) return [];

    const placeholders = walletIds.map((_, i) => `$${i + 1}`).join(',');
    const rows: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT
        f.id,
        f."transactionId",
        f."walletId",
        f.mint,
        f.amount,
        f.direction,
        f."valueUsd",
        t.timestamp
      FROM transaction_flows f
      JOIN transactions t ON t.id = f."transactionId"
      WHERE f."walletId" IN (${placeholders})
      ORDER BY t.timestamp ASC, f.id ASC
    `, ...walletIds);

    return rows.map(r => ({
      id: r.id,
      transactionId: r.transactionId,
      walletId: r.walletId,
      mint: r.mint,
      amount: r.amount,
      direction: r.direction,
      valueUsd: r.valueUsd,
      timestamp: r.timestamp instanceof Date ? r.timestamp : new Date(r.timestamp),
    }));
  }

  private async saveSnapshot(
    userId: string,
    mint: string,
    method: string,
    taxYear: number,
    result: MintResult,
  ): Promise<void> {
    await this.snapshotRepo.upsert(userId, mint, method, taxYear, {
      totalAcquired: new Prisma.Decimal(result.totalAcquired.toFixed(18)),
      totalDisposed: new Prisma.Decimal(result.totalDisposed.toFixed(18)),
      totalCostBasis: new Prisma.Decimal(result.totalCostBasis.toFixed(8)),
      totalProceeds: new Prisma.Decimal(result.totalProceeds.toFixed(8)),
      realizedGainLoss: new Prisma.Decimal(result.realizedGainLoss.toFixed(8)),
      unrealizedCostBasis: new Prisma.Decimal(
        (result.remainingAmount > 0
          ? result.totalCostBasis - result.totalProceeds + result.realizedGainLoss
          : 0
        ).toFixed(8),
      ),
      shortTermGainLoss: new Prisma.Decimal(result.shortTermGainLoss.toFixed(8)),
      longTermGainLoss: new Prisma.Decimal(result.longTermGainLoss.toFixed(8)),
      holdingsCount: result.holdingsCount,
      remainingAmount: new Prisma.Decimal(result.remainingAmount.toFixed(18)),
      computedAt: new Date(),
    });
  }
}

interface FlowRecord {
  id: string;
  transactionId: string;
  walletId: string;
  mint: string;
  amount: any; // Prisma Decimal
  direction: string;
  valueUsd: any; // Prisma Decimal | null
  timestamp: Date;
}
