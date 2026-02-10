import { BaseBee, BeeResult, BeeOptions } from '../base';
import { getTaxRate, TAX_THRESHOLDS } from '@auditswarm/common';
import type { CapitalGainsReport, IncomeReport, JurisdictionCode, Transaction } from '@auditswarm/common';

/**
 * EU Jurisdiction Bee
 *
 * Handles EU/MiCA compliance including:
 * - MiCA (Markets in Crypto-Assets) categorization
 * - DAC8 reporting format
 * - Travel Rule compliance (> €1,000 threshold)
 * - General EU tax guidelines
 */
export class EUBee extends BaseBee {
  readonly jurisdiction: JurisdictionCode = 'EU';
  readonly name = 'EU/MiCA Compliance Bee';
  readonly version = '1.0.0';

  // EU generally uses 1 year for long-term (varies by country)
  protected isLongTermHolding(holdingDays: number): boolean {
    return holdingDays > 365;
  }

  async calculateEstimatedTax(
    capitalGains: CapitalGainsReport,
    income: IncomeReport,
  ): Promise<number> {
    let estimatedTax = 0;

    // EU has varied rates by country, use simplified estimate
    const capitalGainsRate = getTaxRate('EU', 'capital_gains_short');
    const incomeRate = getTaxRate('EU', 'income');

    if (capitalGains.totalNet > 0) {
      estimatedTax += capitalGains.totalNet * capitalGainsRate;
    }

    if (income.total > 0) {
      estimatedTax += income.total * incomeRate;
    }

    return Math.round(estimatedTax * 100) / 100;
  }

  async generateReport(result: BeeResult, format: string): Promise<Buffer> {
    switch (format) {
      case 'MiCA':
        return this.generateMiCAReport(result);
      case 'DAC8':
        return this.generateDAC8Report(result);
      case 'TravelRule':
        return this.generateTravelRuleReport(result);
      default:
        return this.generateDAC8Report(result);
    }
  }

  /**
   * Check Travel Rule compliance
   * Transactions > €1,000 require originator/beneficiary information
   */
  async checkTravelRule(transactions: Transaction[]): Promise<{
    compliant: boolean;
    violations: { transaction: string; amount: number }[];
  }> {
    const threshold = TAX_THRESHOLDS.EU.TRAVEL_RULE_THRESHOLD;
    const violations: { transaction: string; amount: number }[] = [];

    for (const tx of transactions) {
      const valueEur = Number(tx.totalValueUsd ?? 0) * 0.92; // Approximate USD to EUR

      if (valueEur > threshold) {
        // In production, check if originator/beneficiary info is available
        // For now, flag all transactions above threshold
        violations.push({
          transaction: tx.signature ?? tx.id,
          amount: valueEur,
        });
      }
    }

    return {
      compliant: violations.length === 0,
      violations,
    };
  }

  /**
   * Categorize assets according to MiCA
   */
  categorizeAssets(result: BeeResult): {
    eMoney: string[];
    assetReferenced: string[];
    cryptoAssets: string[];
    utilityTokens: string[];
  } {
    // Simplified categorization
    // In production, this would use a database of known token types
    const categorized = {
      eMoney: [] as string[], // Stablecoins pegged to fiat
      assetReferenced: [] as string[], // Stablecoins backed by assets
      cryptoAssets: [] as string[], // Native cryptocurrencies
      utilityTokens: [] as string[], // Platform/service tokens
    };

    for (const asset of result.holdings.assets) {
      // Simple heuristic based on symbol
      const symbol = asset.symbol.toUpperCase();

      if (['USDC', 'USDT', 'EURC', 'EURS'].includes(symbol)) {
        categorized.eMoney.push(asset.mint);
      } else if (['DAI', 'FRAX', 'LUSD'].includes(symbol)) {
        categorized.assetReferenced.push(asset.mint);
      } else if (['SOL', 'ETH', 'BTC'].includes(symbol)) {
        categorized.cryptoAssets.push(asset.mint);
      } else {
        categorized.utilityTokens.push(asset.mint);
      }
    }

    return categorized;
  }

  private async generateMiCAReport(result: BeeResult): Promise<Buffer> {
    const categories = this.categorizeAssets(result);

    const lines: string[] = [
      'MiCA Compliance Report',
      '=' .repeat(60),
      '',
      'Asset Classification under MiCA Regulation',
      '-'.repeat(40),
      '',
      'Electronic Money Tokens (EMT):',
      ...categories.eMoney.map(m => `  - ${m.slice(0, 8)}...`),
      '',
      'Asset-Referenced Tokens (ART):',
      ...categories.assetReferenced.map(m => `  - ${m.slice(0, 8)}...`),
      '',
      'Other Crypto-Assets:',
      ...categories.cryptoAssets.map(m => `  - ${m.slice(0, 8)}...`),
      '',
      'Utility Tokens:',
      ...categories.utilityTokens.map(m => `  - ${m.slice(0, 8)}...`),
      '',
      'Compliance Notes:',
      '-'.repeat(40),
      '- EMT and ART issuers must be authorized under MiCA',
      '- CASP (Crypto-Asset Service Providers) requirements apply',
      '- Whitepaper requirements for new token offerings',
    ];

    return Buffer.from(lines.join('\n'));
  }

  private async generateDAC8Report(result: BeeResult): Promise<Buffer> {
    // DAC8 requires reporting of all crypto transactions
    const lines: string[] = [
      'DAC8 - Directive on Administrative Cooperation',
      '=' .repeat(60),
      '',
      'Crypto-Asset Transaction Report',
      '-'.repeat(40),
      '',
      'Reporting Period Summary:',
      `  Total Transactions: ${result.capitalGains.transactions.length}`,
      `  Total Disposals Value: €${(result.capitalGains.shortTermGains + result.capitalGains.longTermGains).toFixed(2)}`,
      `  Total Acquisitions Value: €${(result.capitalGains.shortTermGains + result.capitalGains.longTermGains - result.capitalGains.totalNet).toFixed(2)}`,
      `  Net Gain/Loss: €${result.capitalGains.totalNet.toFixed(2)}`,
      '',
      'Income from Crypto-Assets:',
      `  Staking Rewards: €${result.income.staking.toFixed(2)}`,
      `  Airdrops: €${result.income.airdrops.toFixed(2)}`,
      `  Other Income: €${result.income.other.toFixed(2)}`,
      `  Total Income: €${result.income.total.toFixed(2)}`,
      '',
      'Year-End Holdings:',
      '-'.repeat(40),
    ];

    for (const asset of result.holdings.assets) {
      lines.push(`  ${asset.symbol}: ${asset.balance.toFixed(4)}`);
    }

    lines.push(
      '',
      'Note: All values converted to EUR at transaction date rates',
    );

    return Buffer.from(lines.join('\n'));
  }

  private async generateTravelRuleReport(result: BeeResult): Promise<Buffer> {
    const threshold = TAX_THRESHOLDS.EU.TRAVEL_RULE_THRESHOLD;

    const lines: string[] = [
      'Travel Rule Compliance Report',
      '=' .repeat(60),
      '',
      `Threshold: €${threshold.toLocaleString()}`,
      '',
      'Transactions Requiring Travel Rule Information:',
      '-'.repeat(40),
    ];

    const largeTransactions = result.capitalGains.transactions.filter(
      tx => tx.proceeds > threshold,
    );

    if (largeTransactions.length === 0) {
      lines.push('No transactions above threshold.');
    } else {
      for (const tx of largeTransactions) {
        lines.push(
          `  ${tx.dateSold.toISOString().split('T')[0]} | ${tx.asset} | €${tx.proceeds.toFixed(2)}`,
          `    Signature: ${tx.transactionSignature}`,
        );
      }
    }

    lines.push(
      '',
      'Travel Rule Requirements:',
      '- Originator name and account identifier',
      '- Beneficiary name and account identifier',
      '- Information must be transmitted with transfer',
    );

    return Buffer.from(lines.join('\n'));
  }
}

export default EUBee;
