import { BaseBee, BeeResult, BeeOptions, BeeContext } from '../base';
import { getTaxRate, TAX_THRESHOLDS } from '@auditswarm/common';
import type {
  CapitalGainsReport,
  IncomeReport,
  JurisdictionCode,
  Transaction,
  Form8949Box,
  ScheduleDSummary,
  FBARReport,
  FBARAccount,
} from '@auditswarm/common';

/**
 * Map of exchange names to their country of incorporation.
 * Used for FBAR / FATCA foreign-account detection.
 */
const EXCHANGE_COUNTRY_MAP: Record<string, { country: string; foreign: boolean }> = {
  binance:    { country: 'Cayman Islands', foreign: true },
  okx:        { country: 'Seychelles',     foreign: true },
  bybit:      { country: 'UAE',            foreign: true },
  kucoin:     { country: 'Seychelles',     foreign: true },
  bitfinex:   { country: 'BVI',            foreign: true },
  huobi:      { country: 'Seychelles',     foreign: true },
  htx:        { country: 'Seychelles',     foreign: true },
  gateio:     { country: 'Cayman Islands', foreign: true },
  mexc:       { country: 'Seychelles',     foreign: true },
  // US-based exchanges — NOT foreign
  coinbase:   { country: 'US', foreign: false },
  'binance.us': { country: 'US', foreign: false },
  kraken:     { country: 'US', foreign: false },
  gemini:     { country: 'US', foreign: false },
  robinhood:  { country: 'US', foreign: false },
};

/**
 * US Jurisdiction Bee
 *
 * Handles US tax compliance including:
 * - IRS Form 8949 (Sales and Dispositions of Capital Assets)
 *   - Box G/H/I (short-term) and J/K/L (long-term) for digital assets
 * - Schedule D (Capital Gains and Losses)
 *   - Capital loss deduction cap (-$3,000/year)
 *   - Loss carryforward tracking
 * - FBAR (FinCEN Form 114) — foreign accounts > $10,000
 * - Form 8938 (FATCA) — foreign assets > $50,000
 * - NIIT 3.8% surtax on net investment income > $200K
 */
export class USBee extends BaseBee {
  readonly jurisdiction: JurisdictionCode = 'US';
  readonly name = 'US Tax Compliance Bee';
  readonly version = '2.0.0';

  // US holding period: > 1 year for long-term
  protected isLongTermHolding(holdingDays: number): boolean {
    return holdingDays > 365;
  }

  async process(
    transactions: Transaction[],
    taxYear: number,
    options: BeeOptions,
    context?: BeeContext,
  ): Promise<BeeResult> {
    // Call base process (computes capital gains, income, holdings)
    const result = await super.process(transactions, taxYear, options, context);

    // Enrich capital gains transactions with Form 8949 fields
    this.assignForm8949Boxes(result, transactions);

    // Build Schedule D summary with $3K loss cap
    const scheduleDSummary = this.buildScheduleD(result.capitalGains, result.income);

    // Build FBAR/FATCA report from exchange transactions
    const fbarReport = this.buildFBARReport(transactions, taxYear);

    // Recalculate tax with proper marginal brackets + NIIT
    result.estimatedTax = this.calculateMarginalTax(
      result.capitalGains,
      result.income,
      scheduleDSummary,
    );

    // Attach US-specific data (stored in metadata for now, will be in AuditResult)
    (result as any).scheduleDSummary = scheduleDSummary;
    (result as any).fbarReport = fbarReport;

    // Add US-specific recommendations
    result.recommendations.push(...this.getUSRecommendations(result, scheduleDSummary, fbarReport));

    // Add US-specific issues
    result.issues.push(...this.getUSIssues(fbarReport));

    return result;
  }

  // ─── Form 8949 Box Assignment ───

  /**
   * Assign Form 8949 box categories to each capital gain transaction.
   * Digital assets use boxes G/H/I (short-term) and J/K/L (long-term).
   * Since most DeFi/on-chain transactions lack a 1099-DA, default to Box I/L.
   */
  private assignForm8949Boxes(result: BeeResult, transactions: Transaction[]): void {
    // Build a map of tx source (exchange name) by transaction ID
    const txSourceMap = new Map<string, string>();
    for (const tx of transactions) {
      if (tx.source === 'EXCHANGE' && tx.exchangeName) {
        txSourceMap.set(tx.id, tx.exchangeName.toLowerCase());
      }
    }

    for (const gain of result.capitalGains.transactions) {
      const exchangeName = txSourceMap.get(gain.id);
      const isFromExchange = !!exchangeName;

      // Determine box based on source and term
      let box: Form8949Box;
      if (gain.type === 'SHORT_TERM') {
        // Box I: no 1099-DA (DeFi, on-chain, foreign exchanges)
        // Box H: 1099-DA without basis (US exchanges that don't report basis)
        // Box G: 1099-DA with basis (US exchanges, post-2026)
        box = isFromExchange ? 'H' : 'I';
      } else {
        box = isFromExchange ? 'K' : 'L';
      }

      gain.form8949Box = box;
      gain.exchangeSource = exchangeName;

      // Build full description: "1.5 SOL (Solana)"
      if (gain.unitsDisposed) {
        gain.description = `${gain.unitsDisposed} ${gain.asset}`;
      } else {
        gain.description = gain.asset;
      }

      // Adjustment code for missing cost basis
      if (gain.costBasis === 0 && gain.proceeds > 0) {
        gain.adjustmentCode = 'B'; // Basis not reported correctly
        gain.adjustmentAmount = 0;
      }
    }
  }

  // ─── Schedule D Summary ───

  /**
   * Build Schedule D summary with capital loss deduction cap.
   * US tax law limits capital loss deductions to $3,000/year ($1,500 MFS).
   * Excess losses carry forward to future tax years.
   */
  private buildScheduleD(
    capitalGains: CapitalGainsReport,
    income: IncomeReport,
  ): ScheduleDSummary {
    // Part I: Short-term totals
    const shortTermProceeds = capitalGains.transactions
      .filter(t => t.type === 'SHORT_TERM')
      .reduce((sum, t) => sum + t.proceeds, 0);
    const shortTermCostBasis = capitalGains.transactions
      .filter(t => t.type === 'SHORT_TERM')
      .reduce((sum, t) => sum + t.costBasis, 0);
    const shortTermGainLoss = capitalGains.netShortTerm;

    // Part II: Long-term totals
    const longTermProceeds = capitalGains.transactions
      .filter(t => t.type === 'LONG_TERM')
      .reduce((sum, t) => sum + t.proceeds, 0);
    const longTermCostBasis = capitalGains.transactions
      .filter(t => t.type === 'LONG_TERM')
      .reduce((sum, t) => sum + t.costBasis, 0);
    const longTermGainLoss = capitalGains.netLongTerm;

    // Part III: Combined
    const totalNetGainLoss = shortTermGainLoss + longTermGainLoss;

    // Capital loss deduction cap: max -$3,000 per year
    const LOSS_CAP = -3000;
    let capitalLossDeduction = 0;
    let capitalLossCarryforward = 0;

    if (totalNetGainLoss < 0) {
      capitalLossDeduction = Math.max(totalNetGainLoss, LOSS_CAP); // e.g. -2000 or -3000
      capitalLossCarryforward = Math.abs(totalNetGainLoss - capitalLossDeduction); // excess
    }

    // NIIT: 3.8% on net investment income if MAGI > $200K (single) / $250K (MFJ)
    // We approximate by checking if total gains + income exceed threshold
    const NIIT_THRESHOLD = 200000; // Single filer default
    const NIIT_RATE = 0.038;
    const totalInvestmentIncome = Math.max(0, totalNetGainLoss) + income.total;
    const niitAmount = totalInvestmentIncome > NIIT_THRESHOLD
      ? (totalInvestmentIncome - NIIT_THRESHOLD) * NIIT_RATE
      : 0;

    return {
      shortTermProceeds: round2(shortTermProceeds),
      shortTermCostBasis: round2(shortTermCostBasis),
      shortTermGainLoss: round2(shortTermGainLoss),
      longTermProceeds: round2(longTermProceeds),
      longTermCostBasis: round2(longTermCostBasis),
      longTermGainLoss: round2(longTermGainLoss),
      totalNetGainLoss: round2(totalNetGainLoss),
      capitalLossDeduction: round2(capitalLossDeduction),
      capitalLossCarryforward: round2(capitalLossCarryforward),
      niitAmount: round2(niitAmount),
    };
  }

  // ─── FBAR / FATCA ───

  /**
   * Build FBAR report by analyzing exchange transactions.
   * Detects foreign exchanges and computes peak monthly balances.
   */
  private buildFBARReport(transactions: Transaction[], taxYear: number): FBARReport {
    const yearStart = new Date(taxYear, 0, 1);
    const yearEnd = new Date(taxYear, 11, 31, 23, 59, 59);

    // Group exchange transactions by exchange name
    const exchangeBalances = new Map<string, {
      exchangeName: string;
      balanceUsd: number;
      peakBalance: number;
      peakDate: Date;
    }>();

    // Sort transactions chronologically for running balance
    const sortedTxs = transactions
      .filter(tx => tx.source === 'EXCHANGE' && tx.timestamp >= yearStart && tx.timestamp <= yearEnd)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    for (const tx of sortedTxs) {
      const name = (tx.exchangeName || 'unknown').toLowerCase();
      if (!exchangeBalances.has(name)) {
        exchangeBalances.set(name, {
          exchangeName: name,
          balanceUsd: 0,
          peakBalance: 0,
          peakDate: tx.timestamp,
        });
      }

      const entry = exchangeBalances.get(name)!;

      // Track running balance based on deposits/withdrawals
      for (const transfer of tx.transfers) {
        if (transfer.isFee) continue;
        const usd = transfer.valueUsd || 0;
        if (transfer.direction === 'IN') {
          entry.balanceUsd += usd;
        } else {
          entry.balanceUsd -= usd;
        }
      }

      // Track peak
      if (entry.balanceUsd > entry.peakBalance) {
        entry.peakBalance = entry.balanceUsd;
        entry.peakDate = tx.timestamp;
      }
    }

    // Build account entries
    const accounts: FBARAccount[] = [];
    for (const [name, data] of exchangeBalances) {
      const exchangeInfo = EXCHANGE_COUNTRY_MAP[name] || { country: 'Unknown', foreign: true };
      accounts.push({
        exchangeName: capitalizeFirst(name),
        exchangeCountry: exchangeInfo.country,
        accountIdentifier: `${name}-account`,
        peakBalance: round2(data.peakBalance),
        peakBalanceDate: data.peakDate,
        isForeignExchange: exchangeInfo.foreign,
      });
    }

    // Only foreign accounts count toward FBAR threshold
    const foreignAccounts = accounts.filter(a => a.isForeignExchange);
    const aggregatePeakValue = foreignAccounts.reduce((sum, a) => sum + a.peakBalance, 0);

    const fbarThreshold = TAX_THRESHOLDS.US.FBAR_THRESHOLD;
    const fatcaThreshold = TAX_THRESHOLDS.US.FORM_8938_THRESHOLD;

    return {
      accounts,
      aggregatePeakValue: round2(aggregatePeakValue),
      fbarRequired: aggregatePeakValue > fbarThreshold,
      fatcaRequired: aggregatePeakValue > fatcaThreshold,
      fbarThreshold,
      fatcaThreshold,
    };
  }

  // ─── Tax Calculation ───

  /**
   * Calculate estimated tax using marginal brackets.
   * Short-term gains taxed as ordinary income (10%-37%).
   * Long-term gains at preferential rates (0%/15%/20%).
   * NIIT 3.8% on investment income above threshold.
   */
  private calculateMarginalTax(
    capitalGains: CapitalGainsReport,
    income: IncomeReport,
    scheduleD: ScheduleDSummary,
  ): number {
    let estimatedTax = 0;

    // Short-term gains taxed at ordinary income brackets (marginal)
    if (capitalGains.netShortTerm > 0) {
      estimatedTax += this.applyMarginalBrackets(capitalGains.netShortTerm, 'short');
    }

    // Long-term gains at preferential rates (marginal)
    if (capitalGains.netLongTerm > 0) {
      estimatedTax += this.applyMarginalBrackets(capitalGains.netLongTerm, 'long');
    }

    // Income (staking, airdrops) taxed as ordinary income
    if (income.total > 0) {
      estimatedTax += this.applyMarginalBrackets(income.total, 'short');
    }

    // Capital loss deduction reduces tax (if net is negative, cap at -$3K)
    if (scheduleD.capitalLossDeduction < 0) {
      // The deduction offsets ordinary income at marginal rate (~22% avg)
      estimatedTax += scheduleD.capitalLossDeduction * 0.22;
    }

    // NIIT 3.8%
    estimatedTax += scheduleD.niitAmount;

    return Math.max(0, round2(estimatedTax));
  }

  /**
   * Apply US marginal tax brackets (2025 Single filer).
   */
  private applyMarginalBrackets(amount: number, type: 'short' | 'long'): number {
    if (amount <= 0) return 0;

    if (type === 'long') {
      // Long-term capital gains brackets (2025 Single)
      const brackets = [
        { limit: 48350, rate: 0.00 },
        { limit: 533400, rate: 0.15 },
        { limit: Infinity, rate: 0.20 },
      ];
      return this.applyBrackets(amount, brackets);
    }

    // Short-term / ordinary income brackets (2025 Single)
    const brackets = [
      { limit: 11925, rate: 0.10 },
      { limit: 48475, rate: 0.12 },
      { limit: 103350, rate: 0.22 },
      { limit: 197300, rate: 0.24 },
      { limit: 250525, rate: 0.32 },
      { limit: 626350, rate: 0.35 },
      { limit: Infinity, rate: 0.37 },
    ];
    return this.applyBrackets(amount, brackets);
  }

  private applyBrackets(amount: number, brackets: { limit: number; rate: number }[]): number {
    let tax = 0;
    let remaining = amount;
    let prevLimit = 0;

    for (const bracket of brackets) {
      const bracketSize = bracket.limit - prevLimit;
      const taxable = Math.min(remaining, bracketSize);
      tax += taxable * bracket.rate;
      remaining -= taxable;
      prevLimit = bracket.limit;
      if (remaining <= 0) break;
    }

    return tax;
  }

  // ─── Legacy calculateEstimatedTax (used by base class) ───

  async calculateEstimatedTax(
    capitalGains: CapitalGainsReport,
    income: IncomeReport,
  ): Promise<number> {
    // This is called by super.process(). We recalculate later in process()
    // with the full Schedule D context. Return a simple estimate here.
    let tax = 0;
    if (capitalGains.netShortTerm > 0) {
      tax += this.applyMarginalBrackets(capitalGains.netShortTerm, 'short');
    }
    if (capitalGains.netLongTerm > 0) {
      tax += this.applyMarginalBrackets(capitalGains.netLongTerm, 'long');
    }
    if (income.total > 0) {
      tax += this.applyMarginalBrackets(income.total, 'short');
    }
    return round2(Math.max(0, tax));
  }

  // ─── Recommendations & Issues ───

  private getUSRecommendations(
    result: BeeResult,
    scheduleD: ScheduleDSummary,
    fbar: FBARReport,
  ): string[] {
    const recs: string[] = [];

    if (scheduleD.capitalLossCarryforward > 0) {
      recs.push(
        `Capital loss carryforward of $${scheduleD.capitalLossCarryforward.toLocaleString()} can offset future gains`,
      );
    }

    if (scheduleD.capitalLossDeduction < 0) {
      recs.push(
        `Capital loss deduction of $${Math.abs(scheduleD.capitalLossDeduction).toLocaleString()} offsets ordinary income (max $3,000/year)`,
      );
    }

    if (scheduleD.niitAmount > 0) {
      recs.push(
        `Net Investment Income Tax (NIIT) of $${scheduleD.niitAmount.toLocaleString()} applies — consider tax-loss harvesting`,
      );
    }

    if (fbar.fbarRequired) {
      recs.push(
        `FBAR filing required — foreign account aggregate exceeds $10,000 (file FinCEN Form 114 by April 15)`,
      );
    }

    if (fbar.fatcaRequired) {
      recs.push(
        `FATCA Form 8938 required — foreign assets exceed $50,000 (file with tax return)`,
      );
    }

    // Quarterly estimated tax reminder
    const totalTax = result.estimatedTax;
    if (totalTax > 1000) {
      recs.push(
        'Consider making quarterly estimated tax payments to avoid underpayment penalties (Form 1040-ES)',
      );
    }

    // Form 1040 digital asset question
    recs.push(
      'Answer "Yes" to the digital asset question on Form 1040 (received, sold, exchanged, or disposed of digital assets)',
    );

    return recs;
  }

  private getUSIssues(fbar: FBARReport): import('@auditswarm/common').AuditIssue[] {
    const issues: import('@auditswarm/common').AuditIssue[] = [];

    if (fbar.fbarRequired) {
      const foreignNames = fbar.accounts
        .filter(a => a.isForeignExchange)
        .map(a => a.exchangeName)
        .join(', ');

      issues.push({
        severity: 'HIGH',
        type: 'FBAR_REQUIRED',
        description: `Foreign exchange accounts (${foreignNames}) exceed $10,000 — FBAR filing required`,
        recommendation: 'File FinCEN Form 114 (FBAR) electronically via BSA E-Filing by April 15 (auto-extension to Oct 15)',
      });
    }

    if (fbar.fatcaRequired) {
      issues.push({
        severity: 'MEDIUM',
        type: 'FATCA_REQUIRED',
        description: `Foreign financial assets exceed $50,000 — Form 8938 (FATCA) filing required`,
        recommendation: 'Attach Form 8938 (Statement of Specified Foreign Financial Assets) to your tax return',
      });
    }

    return issues;
  }

  // ─── Report Generation ───

  async generateReport(result: BeeResult, format: string): Promise<Buffer> {
    switch (format) {
      case 'Form8949':
        return this.generateForm8949(result);
      case 'ScheduleD':
        return this.generateScheduleD(result);
      case 'FBAR':
        return this.generateFBAR(result);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  private async generateForm8949(result: BeeResult): Promise<Buffer> {
    const lines: string[] = [
      'Form 8949 — Sales and Other Dispositions of Capital Assets',
      '=' .repeat(70),
      '',
    ];

    // Part I: Short-Term (Boxes G, H, I)
    const shortTerm = result.capitalGains.transactions.filter(t => t.type === 'SHORT_TERM');
    const boxGroups = { G: [] as typeof shortTerm, H: [] as typeof shortTerm, I: [] as typeof shortTerm };
    for (const tx of shortTerm) {
      const box = (tx.form8949Box || 'I') as 'G' | 'H' | 'I';
      if (box in boxGroups) boxGroups[box].push(tx);
    }

    lines.push('Part I — Short-Term Capital Gains and Losses (held one year or less)');
    lines.push('-'.repeat(70));

    for (const [box, txs] of Object.entries(boxGroups) as [string, typeof shortTerm][]) {
      if (txs.length === 0) continue;
      lines.push(`\n  Check Box ${box}`);
      lines.push('  (a) Description      | (b) Acquired | (c) Sold    | (d) Proceeds | (e) Cost    | (f) Code | (h) Gain/Loss');
      for (const tx of txs) {
        const desc = (tx.description || tx.asset).padEnd(20).slice(0, 20);
        const acq = fmtDate(tx.dateAcquired);
        const sold = fmtDate(tx.dateSold);
        const code = (tx.adjustmentCode || '').padEnd(4);
        lines.push(
          `  ${desc} | ${acq}  | ${sold}  | ${fmtUsd(tx.proceeds)} | ${fmtUsd(tx.costBasis)} | ${code}   | ${fmtUsd(tx.gainLoss)}`,
        );
      }
      const totals = txs.reduce(
        (acc, t) => ({ proceeds: acc.proceeds + t.proceeds, cost: acc.cost + t.costBasis, gain: acc.gain + t.gainLoss }),
        { proceeds: 0, cost: 0, gain: 0 },
      );
      lines.push(`  ${'Totals'.padEnd(20)} |              |             | ${fmtUsd(totals.proceeds)} | ${fmtUsd(totals.cost)} |          | ${fmtUsd(totals.gain)}`);
    }

    // Part II: Long-Term (Boxes J, K, L)
    const longTerm = result.capitalGains.transactions.filter(t => t.type === 'LONG_TERM');
    const ltBoxes = { J: [] as typeof longTerm, K: [] as typeof longTerm, L: [] as typeof longTerm };
    for (const tx of longTerm) {
      const box = (tx.form8949Box || 'L') as 'J' | 'K' | 'L';
      if (box in ltBoxes) ltBoxes[box].push(tx);
    }

    lines.push('', 'Part II — Long-Term Capital Gains and Losses (held more than one year)');
    lines.push('-'.repeat(70));

    for (const [box, txs] of Object.entries(ltBoxes) as [string, typeof longTerm][]) {
      if (txs.length === 0) continue;
      lines.push(`\n  Check Box ${box}`);
      lines.push('  (a) Description      | (b) Acquired | (c) Sold    | (d) Proceeds | (e) Cost    | (f) Code | (h) Gain/Loss');
      for (const tx of txs) {
        const desc = (tx.description || tx.asset).padEnd(20).slice(0, 20);
        lines.push(
          `  ${desc} | ${fmtDate(tx.dateAcquired)}  | ${fmtDate(tx.dateSold)}  | ${fmtUsd(tx.proceeds)} | ${fmtUsd(tx.costBasis)} | ${(tx.adjustmentCode || '').padEnd(4)}   | ${fmtUsd(tx.gainLoss)}`,
        );
      }
    }

    if (longTerm.length === 0) {
      lines.push('  (No long-term transactions)');
    }

    return Buffer.from(lines.join('\n'));
  }

  private async generateScheduleD(result: BeeResult): Promise<Buffer> {
    const sd = (result as any).scheduleDSummary as ScheduleDSummary | undefined;
    const cg = result.capitalGains;

    const lines: string[] = [
      'Schedule D (Form 1040) — Capital Gains and Losses',
      '=' .repeat(70),
      '',
      'Part I — Short-Term Capital Gains and Losses',
      '-'.repeat(50),
      `  Line 1a (Box G): Proceeds: ${fmtUsd(0)}  Cost: ${fmtUsd(0)}  Gain/Loss: ${fmtUsd(0)}`,
    ];

    if (sd) {
      lines.push(
        `  Line 1b (Box H): See Form 8949`,
        `  Line 1c (Box I): Proceeds: ${fmtUsd(sd.shortTermProceeds)}  Cost: ${fmtUsd(sd.shortTermCostBasis)}  Gain/Loss: ${fmtUsd(sd.shortTermGainLoss)}`,
        `  Line 7  Net short-term: ${fmtUsd(sd.shortTermGainLoss)}`,
        '',
        'Part II — Long-Term Capital Gains and Losses',
        '-'.repeat(50),
        `  Line 8a (Box J): Proceeds: ${fmtUsd(0)}  Cost: ${fmtUsd(0)}  Gain/Loss: ${fmtUsd(0)}`,
        `  Line 8b (Box K): See Form 8949`,
        `  Line 8c (Box L): Proceeds: ${fmtUsd(sd.longTermProceeds)}  Cost: ${fmtUsd(sd.longTermCostBasis)}  Gain/Loss: ${fmtUsd(sd.longTermGainLoss)}`,
        `  Line 15 Net long-term: ${fmtUsd(sd.longTermGainLoss)}`,
        '',
        'Part III — Summary',
        '-'.repeat(50),
        `  Line 16: Combine lines 7 and 15: ${fmtUsd(sd.totalNetGainLoss)}`,
      );

      if (sd.capitalLossDeduction < 0) {
        lines.push(
          `  Line 21: Capital loss deduction (max -$3,000): ${fmtUsd(sd.capitalLossDeduction)}`,
          `  Capital loss carryforward to next year: ${fmtUsd(sd.capitalLossCarryforward)}`,
        );
      } else {
        lines.push(`  Line 21: Net capital gain: ${fmtUsd(sd.totalNetGainLoss)}`);
      }

      if (sd.niitAmount > 0) {
        lines.push(`  Net Investment Income Tax (3.8%): ${fmtUsd(sd.niitAmount)}`);
      }
    } else {
      lines.push(
        `  Net short-term: ${fmtUsd(cg.netShortTerm)}`,
        '',
        'Part II — Long-Term Capital Gains and Losses',
        '-'.repeat(50),
        `  Net long-term: ${fmtUsd(cg.netLongTerm)}`,
        '',
        'Part III — Summary',
        '-'.repeat(50),
        `  Net capital gain/loss: ${fmtUsd(cg.totalNet)}`,
      );
    }

    return Buffer.from(lines.join('\n'));
  }

  private async generateFBAR(result: BeeResult): Promise<Buffer> {
    const fbar = (result as any).fbarReport as FBARReport | undefined;

    const lines: string[] = [
      'FinCEN Form 114 — Report of Foreign Bank and Financial Accounts (FBAR)',
      '=' .repeat(70),
      '',
      `Reporting Threshold: $${TAX_THRESHOLDS.US.FBAR_THRESHOLD.toLocaleString()} aggregate at any time during the year`,
      '',
    ];

    if (fbar) {
      const foreignAccounts = fbar.accounts.filter(a => a.isForeignExchange);
      const domesticAccounts = fbar.accounts.filter(a => !a.isForeignExchange);

      if (foreignAccounts.length > 0) {
        lines.push('Foreign Financial Accounts:', '-'.repeat(50));
        for (const acc of foreignAccounts) {
          lines.push(
            `  Exchange: ${acc.exchangeName}`,
            `  Country: ${acc.exchangeCountry}`,
            `  Peak Balance: ${fmtUsd(acc.peakBalance)}`,
            `  Account ID: ${acc.accountIdentifier}`,
            '',
          );
        }
        lines.push(`Aggregate Peak Value (Foreign): ${fmtUsd(fbar.aggregatePeakValue)}`);
      }

      if (domesticAccounts.length > 0) {
        lines.push('', 'Domestic Accounts (not FBAR-reportable):', '-'.repeat(50));
        for (const acc of domesticAccounts) {
          lines.push(`  ${acc.exchangeName} (${acc.exchangeCountry}) — Peak: ${fmtUsd(acc.peakBalance)}`);
        }
      }

      lines.push('');
      if (fbar.fbarRequired) {
        lines.push('STATUS: FBAR FILING REQUIRED');
        lines.push('  File electronically via BSA E-Filing System (https://bsaefiling.fincen.treas.gov)');
        lines.push('  Deadline: April 15 (automatic extension to October 15)');
        lines.push('  Penalties for non-filing: up to $16,536 per report (non-willful)');
      } else {
        lines.push('STATUS: Below FBAR threshold — filing not required');
      }

      if (fbar.fatcaRequired) {
        lines.push('');
        lines.push('FATCA Form 8938 ALSO REQUIRED');
        lines.push(`  Foreign assets exceed $${fbar.fatcaThreshold.toLocaleString()} threshold`);
        lines.push('  Attach Form 8938 to your tax return');
      }
    } else {
      lines.push('No exchange account data available for FBAR analysis.');
    }

    return Buffer.from(lines.join('\n'));
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }
}

// ─── Helpers ───

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padStart(12);
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default USBee;
