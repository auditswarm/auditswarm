import type {
  Transaction,
  AuditResult,
  CapitalGainsReport,
  IncomeReport,
  HoldingsReport,
  AuditIssue,
  JurisdictionCode,
  MonthlyBreakdown,
} from '@auditswarm/common';
import type { FxRateService } from '../services/fx-rate.service';

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
  monthlyBreakdown?: MonthlyBreakdown;
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
 * Injectable context carrying services for bee processing
 */
export interface BeeContext {
  fxService: FxRateService;
  currency: string;
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
    context?: BeeContext,
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
  protected context?: BeeContext;

  /** Well-known stablecoin mints and symbols — cost basis = $1 per unit */
  private static readonly STABLECOIN_MINTS = new Set([
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  ]);
  private static readonly STABLECOIN_SYMBOLS = new Set([
    'USDT', 'USDC', 'BUSD', 'FDUSD', 'USD1', 'DAI', 'TUSD', 'USDP',
    'GUSD', 'FRAX', 'PYUSD', 'USDD', 'CUSD', 'SUSD', 'LUSD',
  ]);

  /** Check if a mint/symbol represents a USD-pegged stablecoin */
  protected static isStablecoin(mint: string, symbol?: string): boolean {
    if (BaseBee.STABLECOIN_MINTS.has(mint)) return true;
    if (symbol && BaseBee.STABLECOIN_SYMBOLS.has(symbol.toUpperCase())) return true;
    // exchange:usdt, exchange:usdc etc
    if (mint.startsWith('exchange:')) {
      return BaseBee.STABLECOIN_SYMBOLS.has(mint.slice(9).toUpperCase());
    }
    return false;
  }

  /** Known fiat currency codes — exchange:* mints with these suffixes are NOT crypto. */
  private static readonly FIAT_CODES = new Set([
    'usd', 'brl', 'eur', 'gbp', 'jpy', 'cad', 'aud', 'chf', 'cny',
    'hkd', 'sgd', 'try', 'ars', 'ngn', 'krw', 'inr', 'mxn', 'cop',
    'clp', 'pen', 'php', 'thb', 'idr', 'vnd', 'zar', 'pln', 'czk',
    'sek', 'nok', 'dkk', 'nzd', 'rub', 'uah', 'gel', 'aed', 'sar',
  ]);

  /**
   * Returns true for fiat or non-crypto mints that should be excluded from
   * cost-basis lots, disposals and holdings.
   *
   * - `fiat:*`      → always fiat
   * - `native`      → SOL lamports already tracked via real mint
   * - `exchange:usd` / `exchange:brl` etc. → fiat on exchanges
   * - `exchange:bnb` / `exchange:ada` etc. → real crypto, NOT fiat
   */
  protected static isFiatOrPseudoMint(mint: string): boolean {
    if (mint === 'native') return true;
    if (mint.startsWith('fiat:')) return true;
    if (mint.startsWith('exchange:')) {
      return BaseBee.FIAT_CODES.has(mint.slice(9));
    }
    return false;
  }

  /**
   * Convert a USD amount to the jurisdiction's local currency.
   * Returns USD unchanged when no context is set or currency is USD.
   */
  protected async toLocal(amountUsd: number, date?: Date): Promise<number> {
    if (!this.context) return amountUsd;
    return this.context.fxService.convert(amountUsd, this.context.currency, date);
  }

  /**
   * Transaction types considered disposals for capital gains.
   * Override in subclasses to customize.
   */
  protected getDisposalTypes(): string[] {
    return [
      'SELL', 'SWAP', 'TRANSFER_OUT',
      'EXCHANGE_TRADE', 'EXCHANGE_C2C_TRADE', 'EXCHANGE_FIAT_SELL',
      'EXCHANGE_DUST_CONVERT', 'EXCHANGE_CONVERT',
      'MARGIN_LIQUIDATION',
    ];
  }

  /**
   * Transaction types considered acquisitions for cost basis.
   * Override in subclasses to customize.
   */
  protected getAcquisitionTypes(): string[] {
    return [
      'BUY', 'TRANSFER_IN', 'SWAP', 'REWARD', 'AIRDROP',
      'EXCHANGE_TRADE', 'EXCHANGE_C2C_TRADE', 'EXCHANGE_FIAT_BUY',
      'EXCHANGE_CONVERT', 'EXCHANGE_DUST_CONVERT',
      'EXCHANGE_INTEREST', 'EXCHANGE_DIVIDEND',
      'EXCHANGE_UNSTAKE', 'MARGIN_BORROW',
      'EXCHANGE_DEPOSIT', // transfer basis: market value at deposit time
    ];
  }

  async process(
    transactions: Transaction[],
    taxYear: number,
    options: BeeOptions,
    context?: BeeContext,
  ): Promise<BeeResult> {
    if (context) this.context = context;
    // Filter transactions for tax year
    const yearStart = new Date(taxYear, 0, 1);
    const yearEnd = new Date(taxYear, 11, 31, 23, 59, 59);

    const filtered = transactions.filter(
      tx => tx.timestamp >= yearStart && tx.timestamp <= yearEnd,
    );

    // Build cost basis lots from ALL transactions (including pre-period)
    // so disposals in the period can match against prior acquisitions
    this.buildCostBasisLots(transactions);

    // Calculate components — only period transactions for gains/income
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
    // NOTE: buildCostBasisLots is called in process() with ALL transactions
    // (including pre-period) so lots are already populated. Only rebuild here
    // when calculateCapitalGains is called standalone (lots map is empty).
    if (this.lots.size === 0) {
      this.buildCostBasisLots(transactions);
    }

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
    const disposalTypes = this.getDisposalTypes();
    const disposals = transactions.filter(tx => disposalTypes.includes(tx.type));

    for (const disposal of disposals) {
      for (const transfer of disposal.transfers) {
        if (transfer.isFee) continue;
        if (BaseBee.isFiatOrPseudoMint(transfer.mint)) continue;
        if (transfer.direction === 'OUT' && transfer.valueUsd) {
          const lot = this.matchLot(transfer.mint, Number(transfer.amount), method);
          const proceeds = transfer.valueUsd;
          // Stablecoins: cost basis = $1/unit when no lot matched
          const fallbackCost = BaseBee.isStablecoin(transfer.mint, (transfer as any).symbol)
            ? Number(transfer.amount)
            : 0;
          const costBasis = lot?.costBasis ?? fallbackCost;
          const gainLoss = proceeds - costBasis;

          const holdingDays = lot
            ? Math.floor((disposal.timestamp.getTime() - lot.dateAcquired.getTime()) / (1000 * 60 * 60 * 24))
            : 0; // No lot → treat as short-term (unknown acquisition date)
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
            dateAcquired: lot?.dateAcquired ?? disposal.timestamp,
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
      } else if (tx.type === 'EXCHANGE_DIVIDEND' && options.includeStaking) {
        type = 'rewards';
        income.rewards += Number(tx.totalValueUsd ?? 0);
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

    // Check for missing cost basis (skip stablecoins — cost basis is always ~$1)
    const seen = new Set<string>();
    for (const gain of result.capitalGains.transactions) {
      if (gain.costBasis === 0) {
        // Skip stablecoins — their cost basis is $1/unit by definition
        if (BaseBee.isStablecoin(gain.asset, gain.asset)) continue;
        // Deduplicate — one issue per asset, not per transaction
        if (seen.has(gain.asset)) continue;
        seen.add(gain.asset);
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
    const holdings = new Map<string, { symbol: string; balance: number; costBasis: number }>();

    // Deposit/withdrawal are internal transfers, not economic events
    const transferTypes = new Set(['EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL']);
    for (const tx of transactions) {
      if (transferTypes.has(tx.type)) continue;

      for (const transfer of tx.transfers) {
        if (transfer.isFee) continue;
        if (BaseBee.isFiatOrPseudoMint(transfer.mint)) continue;

        const fallbackSymbol = transfer.mint.includes(':')
          ? transfer.mint.split(':')[1].toUpperCase()
          : transfer.mint.slice(0, 8);
        const current = holdings.get(transfer.mint) || {
          symbol: (transfer as any).symbol || fallbackSymbol,
          balance: 0,
          costBasis: 0,
        };

        // Prefer real symbol (e.g. 'SOL') over mint-prefix fallback (e.g. 'So11')
        const sym = (transfer as any).symbol;
        if (sym && !transfer.mint.startsWith(sym)) {
          current.symbol = sym;
        }

        if (transfer.direction === 'IN') {
          current.balance += Number(transfer.amount);
          current.costBasis += transfer.valueUsd || 0;
        } else {
          current.balance -= Number(transfer.amount);
        }

        holdings.set(transfer.mint, current);
      }
    }

    // Filter: positive balance, above dust threshold
    const DUST_THRESHOLD = 0.000001;
    const assets = Array.from(holdings.entries())
      .filter(([_, h]) => h.balance > DUST_THRESHOLD)
      .map(([mint, h]) => ({
        mint,
        symbol: h.symbol,
        balance: Math.max(0, h.balance),
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

    const acquisitionTypes = this.getAcquisitionTypes();
    const acquisitions = transactions.filter(tx =>
      acquisitionTypes.includes(tx.type),
    );

    for (const tx of acquisitions) {
      for (const transfer of tx.transfers) {
        if (transfer.isFee) continue;
        if (BaseBee.isFiatOrPseudoMint(transfer.mint)) continue;
        if (transfer.direction === 'IN') {
          let costBasis = transfer.valueUsd || 0;
          // Stablecoins: default to $1/unit when no price recorded
          if (costBasis === 0 && BaseBee.isStablecoin(transfer.mint, (transfer as any).symbol)) {
            costBasis = Number(transfer.amount);
          }
          const lots = this.lots.get(transfer.mint) || [];
          lots.push({
            id: `${tx.id}-${transfer.mint}`,
            transactionId: tx.id,
            asset: transfer.mint,
            amount: Number(transfer.amount),
            costBasis,
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

    // Try exact match first (single lot covers full amount)
    for (const lot of sortedLots) {
      if (lot.remaining >= amount) {
        lot.remaining -= amount;
        return {
          ...lot,
          costBasis: (lot.costBasis / lot.amount) * amount,
        };
      }
    }

    // Partial matching: consume from multiple lots
    let remaining = amount;
    let totalCostBasis = 0;
    let earliestDate = sortedLots[0]?.dateAcquired;
    let matchedAny = false;

    for (const lot of sortedLots) {
      if (lot.remaining <= 0) continue;
      const consume = Math.min(lot.remaining, remaining);
      const lotUnitCost = lot.costBasis / lot.amount;
      totalCostBasis += lotUnitCost * consume;
      if (lot.dateAcquired < earliestDate) earliestDate = lot.dateAcquired;
      lot.remaining -= consume;
      remaining -= consume;
      matchedAny = true;
      if (remaining <= 0) break;
    }

    if (!matchedAny) return null;

    return {
      id: `partial-${asset}`,
      transactionId: '',
      asset,
      amount: amount - remaining,
      costBasis: totalCostBasis,
      dateAcquired: earliestDate,
      remaining: 0,
    };
  }

  protected abstract isLongTermHolding(holdingDays: number): boolean;
}
