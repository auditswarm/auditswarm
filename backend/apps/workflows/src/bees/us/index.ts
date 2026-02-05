import { BaseBee, BeeResult, BeeOptions } from '../base';
import { getTaxRate, TAX_THRESHOLDS } from '@auditswarm/common';
import type { CapitalGainsReport, IncomeReport, JurisdictionCode } from '@auditswarm/common';

/**
 * US Jurisdiction Bee
 *
 * Handles US tax compliance including:
 * - IRS Form 8949 (Sales and Dispositions of Capital Assets)
 * - Schedule D (Capital Gains and Losses)
 * - FBAR reporting for foreign accounts > $10,000
 * - Form 8938 (Statement of Specified Foreign Financial Assets)
 */
export class USBee extends BaseBee {
  readonly jurisdiction: JurisdictionCode = 'US';
  readonly name = 'US Tax Compliance Bee';
  readonly version = '1.0.0';

  // US holding period: > 1 year for long-term
  protected isLongTermHolding(holdingDays: number): boolean {
    return holdingDays > 365;
  }

  async calculateEstimatedTax(
    capitalGains: CapitalGainsReport,
    income: IncomeReport,
  ): Promise<number> {
    let estimatedTax = 0;

    // Short-term capital gains (taxed as ordinary income)
    if (capitalGains.netShortTerm > 0) {
      const shortTermRate = getTaxRate('US', 'capital_gains_short', capitalGains.netShortTerm);
      estimatedTax += capitalGains.netShortTerm * shortTermRate;
    }

    // Long-term capital gains
    if (capitalGains.netLongTerm > 0) {
      const longTermRate = getTaxRate('US', 'capital_gains_long', capitalGains.netLongTerm, 366);
      estimatedTax += capitalGains.netLongTerm * longTermRate;
    }

    // Income (staking, mining, airdrops)
    if (income.total > 0) {
      const incomeRate = getTaxRate('US', 'income', income.total);
      estimatedTax += income.total * incomeRate;
    }

    return Math.round(estimatedTax * 100) / 100;
  }

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
    // Form 8949 has two parts:
    // Part I: Short-term transactions
    // Part II: Long-term transactions

    const lines: string[] = [
      'Form 8949 - Sales and Other Dispositions of Capital Assets',
      '=' .repeat(60),
      '',
      'Part I - Short-Term Capital Gains and Losses',
      '-'.repeat(60),
      'Description | Date Acquired | Date Sold | Proceeds | Cost Basis | Gain/Loss',
    ];

    const shortTerm = result.capitalGains.transactions.filter(t => t.type === 'SHORT_TERM');
    for (const tx of shortTerm) {
      lines.push(
        `${tx.asset} | ${this.formatDate(tx.dateAcquired)} | ${this.formatDate(tx.dateSold)} | $${tx.proceeds.toFixed(2)} | $${tx.costBasis.toFixed(2)} | $${tx.gainLoss.toFixed(2)}`,
      );
    }

    lines.push(`\nTotal Short-Term: $${result.capitalGains.netShortTerm.toFixed(2)}`);

    lines.push(
      '',
      'Part II - Long-Term Capital Gains and Losses',
      '-'.repeat(60),
      'Description | Date Acquired | Date Sold | Proceeds | Cost Basis | Gain/Loss',
    );

    const longTerm = result.capitalGains.transactions.filter(t => t.type === 'LONG_TERM');
    for (const tx of longTerm) {
      lines.push(
        `${tx.asset} | ${this.formatDate(tx.dateAcquired)} | ${this.formatDate(tx.dateSold)} | $${tx.proceeds.toFixed(2)} | $${tx.costBasis.toFixed(2)} | $${tx.gainLoss.toFixed(2)}`,
      );
    }

    lines.push(`\nTotal Long-Term: $${result.capitalGains.netLongTerm.toFixed(2)}`);

    return Buffer.from(lines.join('\n'));
  }

  private async generateScheduleD(result: BeeResult): Promise<Buffer> {
    const lines: string[] = [
      'Schedule D - Capital Gains and Losses',
      '=' .repeat(60),
      '',
      'Part I - Short-Term Capital Gains and Losses',
      `-` .repeat(40),
      `Line 1a: Short-term totals from Form 8949 Part I`,
      `  Proceeds: $${result.capitalGains.shortTermGains.toFixed(2)}`,
      `  Cost: $${(result.capitalGains.shortTermGains - result.capitalGains.netShortTerm).toFixed(2)}`,
      `  Gain/Loss: $${result.capitalGains.netShortTerm.toFixed(2)}`,
      '',
      'Part II - Long-Term Capital Gains and Losses',
      '-'.repeat(40),
      `Line 8a: Long-term totals from Form 8949 Part II`,
      `  Proceeds: $${result.capitalGains.longTermGains.toFixed(2)}`,
      `  Cost: $${(result.capitalGains.longTermGains - result.capitalGains.netLongTerm).toFixed(2)}`,
      `  Gain/Loss: $${result.capitalGains.netLongTerm.toFixed(2)}`,
      '',
      'Part III - Summary',
      '-'.repeat(40),
      `Line 16: Net short-term gain/loss: $${result.capitalGains.netShortTerm.toFixed(2)}`,
      `Line 17: Net long-term gain/loss: $${result.capitalGains.netLongTerm.toFixed(2)}`,
      `Line 21: Net capital gain/loss: $${result.capitalGains.totalNet.toFixed(2)}`,
    ];

    return Buffer.from(lines.join('\n'));
  }

  private async generateFBAR(result: BeeResult): Promise<Buffer> {
    const threshold = TAX_THRESHOLDS.US.FBAR_THRESHOLD;

    const lines: string[] = [
      'FBAR - Report of Foreign Bank and Financial Accounts',
      '=' .repeat(60),
      '',
      `Reporting Threshold: $${threshold.toLocaleString()}`,
      '',
      'Cryptocurrency holdings on foreign exchanges should be reported if',
      'the aggregate value exceeds the threshold at any point during the year.',
      '',
      'Holdings Summary:',
      '-'.repeat(40),
    ];

    for (const asset of result.holdings.assets) {
      lines.push(`${asset.symbol}: ${asset.balance.toFixed(4)} (Value: $${asset.valueUsd.toFixed(2)})`);
    }

    lines.push(
      '',
      `Total Holdings Value: $${result.holdings.totalValueUsd.toFixed(2)}`,
      '',
      result.holdings.totalValueUsd > threshold
        ? '⚠️  FBAR filing may be required'
        : '✓ Below FBAR threshold',
    );

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

export default USBee;
