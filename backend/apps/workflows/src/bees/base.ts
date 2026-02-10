import type {
  Transaction,
  AuditResult,
  CapitalGainsReport,
  IncomeReport,
  HoldingsReport,
  AuditIssue,
  JurisdictionCode,
} from '@auditswarm/common';

/**
 * Configuration options for a jurisdiction bee
 */
export interface BeeOptions {
  costBasisMethod: 'FIFO' | 'LIFO' | 'HIFO' | 'SPECIFIC_ID' | 'AVERAGE';
  includeStaking: boolean;
  includeAirdrops: boolean;
  includeNFTs: boolean;
  includeDeFi: boolean;
  includeFees: boolean;
  currency: string;
}

/**
 * Result of processing transactions
 */
export interface BeeResult {
  capitalGains: CapitalGainsReport;
  income: IncomeReport;
  holdings: HoldingsReport;
  issues: AuditIssue[];
  recommendations: string[];
  estimatedTax: number;
}

/**
 * Cost basis lot for tracking purchases
 */
export interface CostBasisLot {
  id: string;
  transactionId: string;
  asset: string;
  amount: number;
  costBasis: number;
  dateAcquired: Date;
  remaining: number;
}

/**
 * Base interface for jurisdiction-specific compliance bees
 */
export interface JurisdictionBee {
  readonly jurisdiction: JurisdictionCode;
  readonly name: string;
  readonly version: string;

  /**
   * Process transactions and generate tax report
   */
  process(
    transactions: Transaction[],
    taxYear: number,
    options: BeeOptions,
  ): Promise<BeeResult>;

  /**
   * Calculate capital gains using the specified method
   */
  calculateCapitalGains(
    transactions: Transaction[],
    method: BeeOptions['costBasisMethod'],
  ): Promise<CapitalGainsReport>;

  /**
   * Calculate income from staking, airdrops, etc.
   */
  calculateIncome(
    transactions: Transaction[],
    options: BeeOptions,
  ): Promise<IncomeReport>;

  /**
   * Generate jurisdiction-specific report format
   */
  generateReport(result: BeeResult, format: string): Promise<Buffer>;

  /**
   * Identify compliance issues
   */
  identifyIssues(
    transactions: Transaction[],
    result: BeeResult,
  ): Promise<AuditIssue[]>;
}

/**
 * Abstract base class with common functionality
 */
export abstract class BaseBee implements JurisdictionBee {
  abstract readonly jurisdiction: JurisdictionCode;
  abstract readonly name: string;
  abstract readonly version: string;

  protected lots: Map<string, CostBasisLot[]> = new Map();

  async process(
    transactions: Transaction[],
    taxYear: number,
    options: BeeOptions,
  ): Promise<BeeResult> {
    // Filter transactions for tax year
    const yearStart = new Date(taxYear, 0, 1);
    const yearEnd = new Date(taxYear, 11, 31, 23, 59, 59);

    const filtered = transactions.filter(
      tx => tx.timestamp >= yearStart && tx.timestamp <= yearEnd,
    );

    // Calculate components
    const capitalGains = await this.calculateCapitalGains(filtered, options.costBasisMethod);
    const income = await this.calculateIncome(filtered, options);
    const holdings = await this.calculateHoldings(transactions);

    // Calculate estimated tax
    const estimatedTax = await this.calculateEstimatedTax(capitalGains, income);

    // Generate result
    const result: BeeResult = {
      capitalGains,
      income,
      holdings,
      issues: [],
      recommendations: [],
      estimatedTax,
    };

    // Identify issues
    result.issues = await this.identifyIssues(filtered, result);

    // Generate recommendations
    result.recommendations = await this.generateRecommendations(result);

    return result;
  }

  async calculateCapitalGains(
    transactions: Transaction[],
    method: BeeOptions['costBasisMethod'],
  ): Promise<CapitalGainsReport> {
    // Build cost basis lots from acquisitions
    this.buildCostBasisLots(transactions);

    const gains: CapitalGainsReport = {
      shortTermGains: 0,
      shortTermLosses: 0,
      longTermGains: 0,
      longTermLosses: 0,
      netShortTerm: 0,
      netLongTerm: 0,
      totalNet: 0,
      transactions: [],
    };

    // Process disposals — include exchange sell-side types
    const disposalTypes = [
      'SELL', 'SWAP', 'TRANSFER_OUT',
      'EXCHANGE_TRADE', 'EXCHANGE_C2C_TRADE', 'EXCHANGE_FIAT_SELL',
      'EXCHANGE_DUST_CONVERT', 'EXCHANGE_CONVERT',
      'MARGIN_LIQUIDATION',
    ];
    const disposals = transactions.filter(tx => disposalTypes.includes(tx.type));

    for (const disposal of disposals) {
      for (const transfer of disposal.transfers) {
        if (transfer.isFee) continue;
        if (transfer.direction === 'OUT' && transfer.valueUsd) {
          const lot = this.matchLot(transfer.mint, Number(transfer.amount), method);
          if (lot) {
            const proceeds = transfer.valueUsd;
            const costBasis = lot.costBasis;
            const gainLoss = proceeds - costBasis;

            const holdingDays = Math.floor(
              (disposal.timestamp.getTime() - lot.dateAcquired.getTime()) / (1000 * 60 * 60 * 24),
            );
            const isLongTerm = this.isLongTermHolding(holdingDays);

            if (isLongTerm) {
              if (gainLoss > 0) gains.longTermGains += gainLoss;
              else gains.longTermLosses += Math.abs(gainLoss);
            } else {
              if (gainLoss > 0) gains.shortTermGains += gainLoss;
              else gains.shortTermLosses += Math.abs(gainLoss);
            }

            gains.transactions.push({
              id: disposal.id,
              asset: transfer.symbol || transfer.mint,
              dateAcquired: lot.dateAcquired,
              dateSold: disposal.timestamp,
              proceeds,
              costBasis,
              gainLoss,
              type: isLongTerm ? 'LONG_TERM' : 'SHORT_TERM',
              transactionSignature: disposal.signature ?? disposal.id,
            });
          }
        }
      }
    }

    gains.netShortTerm = gains.shortTermGains - gains.shortTermLosses;
    gains.netLongTerm = gains.longTermGains - gains.longTermLosses;
    gains.totalNet = gains.netShortTerm + gains.netLongTerm;

    return gains;
  }

  async calculateIncome(
    transactions: Transaction[],
    options: BeeOptions,
  ): Promise<IncomeReport> {
    const income: IncomeReport = {
      staking: 0,
      mining: 0,
      airdrops: 0,
      rewards: 0,
      other: 0,
      total: 0,
      events: [],
    };

    for (const tx of transactions) {
      let type: string | null = null;
      let value = 0;

      if (tx.type === 'REWARD' && options.includeStaking) {
        type = 'staking';
        income.staking += Number(tx.totalValueUsd ?? 0);
      } else if (tx.type === 'AIRDROP' && options.includeAirdrops) {
        type = 'airdrop';
        income.airdrops += Number(tx.totalValueUsd ?? 0);
      } else if (tx.type === 'EXCHANGE_INTEREST' && options.includeStaking) {
        type = 'staking';
        income.staking += Number(tx.totalValueUsd ?? 0);
      } else if (tx.type === 'EXCHANGE_DIVIDEND' && options.includeAirdrops) {
        type = 'airdrop';
        income.airdrops += Number(tx.totalValueUsd ?? 0);
      } else if (tx.type === 'MARGIN_INTEREST') {
        // Margin interest is a deductible expense — track as negative income
        type = 'other';
        income.other -= Number(tx.totalValueUsd ?? 0);
      }

      if (type && tx.totalValueUsd) {
        value = Number(tx.totalValueUsd);
        income.events.push({
          id: tx.id,
          type,
          asset: tx.transfers[0]?.symbol || 'Unknown',
          amount: Number(tx.transfers[0]?.amount || 0),
          valueUsd: value,
          date: tx.timestamp,
          transactionSignature: tx.signature ?? undefined,
        });
      }
    }

    income.total = income.staking + income.mining + income.airdrops + income.rewards + income.other;
    return income;
  }

  abstract calculateEstimatedTax(
    capitalGains: CapitalGainsReport,
    income: IncomeReport,
  ): Promise<number>;

  abstract generateReport(result: BeeResult, format: string): Promise<Buffer>;

  async identifyIssues(
    transactions: Transaction[],
    result: BeeResult,
  ): Promise<AuditIssue[]> {
    const issues: AuditIssue[] = [];

    // Check for large unreported transactions
    for (const tx of transactions) {
      if (tx.type === 'UNKNOWN' && Number(tx.totalValueUsd ?? 0) > 1000) {
        issues.push({
          severity: 'MEDIUM',
          type: 'UNCLASSIFIED_TRANSACTION',
          description: `Large unclassified transaction: ${tx.signature ?? tx.id}`,
          transaction: tx.signature ?? tx.id,
          recommendation: 'Review and categorize this transaction manually',
        });
      }
    }

    // Check for missing cost basis
    for (const gain of result.capitalGains.transactions) {
      if (gain.costBasis === 0) {
        issues.push({
          severity: 'HIGH',
          type: 'MISSING_COST_BASIS',
          description: `Missing cost basis for ${gain.asset}`,
          transaction: gain.transactionSignature,
          recommendation: 'Provide acquisition date and cost for this asset',
        });
      }
    }

    return issues;
  }

  protected async calculateHoldings(transactions: Transaction[]): Promise<HoldingsReport> {
    // Calculate current holdings based on all transactions
    const holdings = new Map<string, { balance: number; costBasis: number }>();

    // Deposit/withdrawal are internal transfers, not economic events
    const transferTypes = new Set(['EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL']);

    for (const tx of transactions) {
      if (transferTypes.has(tx.type)) continue;

      for (const transfer of tx.transfers) {
        if (transfer.isFee) continue;

        const current = holdings.get(transfer.mint) || { balance: 0, costBasis: 0 };

        if (transfer.direction === 'IN') {
          current.balance += Number(transfer.amount);
          current.costBasis += transfer.valueUsd || 0;
        } else {
          current.balance -= Number(transfer.amount);
        }

        holdings.set(transfer.mint, current);
      }
    }

    const assets = Array.from(holdings.entries())
      .filter(([_, h]) => h.balance > 0)
      .map(([mint, h]) => ({
        mint,
        symbol: mint.slice(0, 4),
        balance: h.balance,
        valueUsd: 0, // Would need price feed
        costBasis: h.costBasis,
        unrealizedGainLoss: 0,
      }));

    return {
      totalValueUsd: assets.reduce((sum, a) => sum + a.valueUsd, 0),
      assets,
      asOf: new Date(),
    };
  }

  protected async generateRecommendations(result: BeeResult): Promise<string[]> {
    const recommendations: string[] = [];

    if (result.capitalGains.shortTermLosses > 0) {
      recommendations.push(
        'Consider tax-loss harvesting opportunities before year end',
      );
    }

    if (result.issues.some(i => i.severity === 'HIGH')) {
      recommendations.push(
        'Address high-severity issues before filing',
      );
    }

    return recommendations;
  }

  protected buildCostBasisLots(transactions: Transaction[]): void {
    this.lots.clear();

    const acquisitionTypes = [
      'BUY', 'TRANSFER_IN', 'SWAP', 'REWARD', 'AIRDROP',
      'EXCHANGE_TRADE', 'EXCHANGE_C2C_TRADE', 'EXCHANGE_FIAT_BUY',
      'EXCHANGE_CONVERT', 'EXCHANGE_DUST_CONVERT',
      'EXCHANGE_INTEREST', 'EXCHANGE_DIVIDEND',
      'EXCHANGE_UNSTAKE', 'MARGIN_BORROW',
    ];
    const acquisitions = transactions.filter(tx =>
      acquisitionTypes.includes(tx.type),
    );

    for (const tx of acquisitions) {
      for (const transfer of tx.transfers) {
        if (transfer.isFee) continue;
        if (transfer.direction === 'IN') {
          const lots = this.lots.get(transfer.mint) || [];
          lots.push({
            id: `${tx.id}-${transfer.mint}`,
            transactionId: tx.id,
            asset: transfer.mint,
            amount: Number(transfer.amount),
            costBasis: transfer.valueUsd || 0,
            dateAcquired: tx.timestamp,
            remaining: Number(transfer.amount),
          });
          this.lots.set(transfer.mint, lots);
        }
      }
    }
  }

  protected matchLot(
    asset: string,
    amount: number,
    method: BeeOptions['costBasisMethod'],
  ): CostBasisLot | null {
    const assetLots = this.lots.get(asset);
    if (!assetLots || assetLots.length === 0) return null;

    // Sort lots based on method
    const sortedLots = [...assetLots].sort((a, b) => {
      switch (method) {
        case 'FIFO':
          return a.dateAcquired.getTime() - b.dateAcquired.getTime();
        case 'LIFO':
          return b.dateAcquired.getTime() - a.dateAcquired.getTime();
        case 'HIFO':
          return (b.costBasis / b.amount) - (a.costBasis / a.amount);
        default:
          return a.dateAcquired.getTime() - b.dateAcquired.getTime();
      }
    });

    // Find lot with remaining amount
    for (const lot of sortedLots) {
      if (lot.remaining >= amount) {
        lot.remaining -= amount;
        return {
          ...lot,
          costBasis: (lot.costBasis / lot.amount) * amount,
        };
      }
    }

    return null;
  }

  protected abstract isLongTermHolding(holdingDays: number): boolean;
}
