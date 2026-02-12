import { BaseBee, BeeResult, BeeOptions, BeeContext } from '../base';
import { getTaxRate, TAX_THRESHOLDS } from '@auditswarm/common';
import type { CapitalGainsReport, IncomeReport, JurisdictionCode, Transaction, MonthlyBreakdown, MonthlyBreakdownEntry } from '@auditswarm/common';

/**
 * Brazil Jurisdiction Bee
 *
 * Handles Brazilian tax compliance including:
 * - IN 1888 (Instrução Normativa) reporting
 * - GCAP (Ganhos de Capital) calculation
 * - DIRPF (Declaração de Imposto de Renda) crypto section
 * - Progressive tax rates for capital gains
 * - Monthly sales exemption threshold (R$35,000)
 */
export class BRBee extends BaseBee {
  readonly jurisdiction: JurisdictionCode = 'BR';
  readonly name = 'Brazil Tax Compliance Bee';
  readonly version = '1.0.0';

  // Brazil uses 1 year for distinguishing rates
  protected isLongTermHolding(holdingDays: number): boolean {
    return holdingDays > 365;
  }

  async process(
    transactions: Transaction[],
    taxYear: number,
    options: BeeOptions,
    context?: BeeContext,
  ): Promise<BeeResult> {
    // Call base process first (computes capital gains in USD)
    const result = await super.process(transactions, taxYear, options, context);

    // Build monthly breakdown with exemption analysis (uses original USD values + toLocal)
    const breakdown = await this.buildMonthlyBreakdown(transactions, taxYear, result.capitalGains);

    // Recalculate tax using only taxable months' gains (already in BRL)
    result.estimatedTax = await this.calculateTaxWithExemptions(breakdown, result.income);
    result.monthlyBreakdown = breakdown;

    // Convert all USD values to BRL for display (after breakdown uses the originals)
    await this.convertResultToBRL(result);

    // Add exemption-based recommendations
    result.recommendations.push(
      ...this.getExemptionRecommendations(breakdown),
    );

    return result;
  }

  /**
   * Convert all USD-denominated values in the result to BRL.
   * Called after monthly breakdown is built (which needs USD originals).
   * Skips estimatedTax since it's already calculated in BRL.
   */
  private async convertResultToBRL(result: BeeResult): Promise<void> {
    const savedTax = result.estimatedTax;

    // Capital gains aggregates
    const cg = result.capitalGains;
    cg.shortTermGains = await this.toLocal(cg.shortTermGains);
    cg.shortTermLosses = await this.toLocal(cg.shortTermLosses);
    cg.longTermGains = await this.toLocal(cg.longTermGains);
    cg.longTermLosses = await this.toLocal(cg.longTermLosses);
    cg.netShortTerm = await this.toLocal(cg.netShortTerm);
    cg.netLongTerm = await this.toLocal(cg.netLongTerm);
    cg.totalNet = await this.toLocal(cg.totalNet);

    // Capital gains transactions
    for (const tx of cg.transactions) {
      tx.proceeds = await this.toLocal(tx.proceeds, tx.dateSold);
      tx.costBasis = await this.toLocal(tx.costBasis, tx.dateAcquired);
      tx.gainLoss = await this.toLocal(tx.gainLoss, tx.dateSold);
    }

    // Income aggregates
    const inc = result.income;
    inc.staking = await this.toLocal(inc.staking);
    inc.mining = await this.toLocal(inc.mining);
    inc.airdrops = await this.toLocal(inc.airdrops);
    inc.rewards = await this.toLocal(inc.rewards);
    inc.other = await this.toLocal(inc.other);
    inc.total = await this.toLocal(inc.total);

    // Income events
    for (const ev of inc.events) {
      ev.valueUsd = await this.toLocal(ev.valueUsd, ev.date);
    }

    // Holdings
    for (const asset of result.holdings.assets) {
      asset.costBasis = await this.toLocal(asset.costBasis);
    }
    result.holdings.totalValueUsd = await this.toLocal(result.holdings.totalValueUsd);

    // Restore tax (already in BRL from calculateTaxWithExemptions)
    result.estimatedTax = savedTax;
  }

  /**
   * Build monthly breakdown with sales volume, capital gains, and exemption status.
   * Sales below R$35,000/month are exempt from capital gains tax.
   *
   * Under Brazilian tax law, the R$35K monthly exemption applies to the total
   * proceeds of ALL crypto alienations in a month — including crypto-to-crypto
   * swaps, exchange trades, and fiat sales. We use capitalGains.transactions
   * (which already contains all disposals) to compute the monthly total.
   */
  async buildMonthlyBreakdown(
    transactions: Transaction[],
    taxYear: number,
    capitalGains: CapitalGainsReport,
  ): Promise<MonthlyBreakdown> {
    const threshold = TAX_THRESHOLDS.BR.MONTHLY_EXEMPT_THRESHOLD;
    const monthLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    // Initialize monthly sales volumes
    const monthlySales = new Array(12).fill(0);

    // Sum all disposal proceeds by month (all alienation types count for R$35K threshold)
    for (const tx of capitalGains.transactions) {
      const month = new Date(tx.dateSold).getMonth();
      const proceedsBRL = await this.toLocal(tx.proceeds, tx.dateSold);
      monthlySales[month] += proceedsBRL;
    }

    // Group capital gain transactions by month and convert to BRL
    const monthlyGains = new Array(12).fill(0);
    for (const tx of capitalGains.transactions) {
      const month = new Date(tx.dateSold).getMonth();
      const gainBRL = await this.toLocal(tx.gainLoss, tx.dateSold);
      monthlyGains[month] += gainBRL;
    }

    // Build entries
    let totalExemptGains = 0;
    let totalTaxableGains = 0;
    let exemptMonths = 0;
    let taxableMonths = 0;

    const entries: MonthlyBreakdownEntry[] = [];
    for (let m = 0; m < 12; m++) {
      const exempt = monthlySales[m] <= threshold;
      const gains = monthlyGains[m];
      const taxableGains = exempt ? 0 : Math.max(0, gains);

      if (exempt && gains > 0) {
        totalExemptGains += gains;
      } else if (!exempt && gains > 0) {
        totalTaxableGains += gains;
      }

      if (exempt && monthlySales[m] > 0) exemptMonths++;
      if (!exempt) taxableMonths++;

      entries.push({
        month: m,
        label: monthLabels[m],
        salesVolume: Math.round(monthlySales[m] * 100) / 100,
        capitalGains: Math.round(gains * 100) / 100,
        exempt,
        taxableGains: Math.round(taxableGains * 100) / 100,
        threshold,
      });
    }

    return {
      entries,
      currency: 'BRL',
      totalExemptGains: Math.round(totalExemptGains * 100) / 100,
      totalTaxableGains: Math.round(totalTaxableGains * 100) / 100,
      exemptMonths,
      taxableMonths,
    };
  }

  /**
   * Calculate tax applying monthly exemptions.
   * Only taxable months' gains are subject to progressive brackets.
   */
  private async calculateTaxWithExemptions(
    breakdown: MonthlyBreakdown,
    income: IncomeReport,
  ): Promise<number> {
    let estimatedTax = 0;

    const taxableGainsBRL = breakdown.totalTaxableGains;

    if (taxableGainsBRL > 0) {
      if (taxableGainsBRL <= 5000000) {
        estimatedTax += taxableGainsBRL * 0.15;
      } else if (taxableGainsBRL <= 10000000) {
        estimatedTax += 5000000 * 0.15 + (taxableGainsBRL - 5000000) * 0.175;
      } else if (taxableGainsBRL <= 30000000) {
        estimatedTax += 5000000 * 0.15 + 5000000 * 0.175 + (taxableGainsBRL - 10000000) * 0.20;
      } else {
        estimatedTax += 5000000 * 0.15 + 5000000 * 0.175 + 20000000 * 0.20 + (taxableGainsBRL - 30000000) * 0.225;
      }
    }

    // Income from staking, etc. taxed as regular income (convert to BRL)
    const incomeBRL = await this.toLocal(income.total);
    if (incomeBRL > 0) {
      const incomeRate = getTaxRate('BR', 'income');
      estimatedTax += incomeBRL * incomeRate;
    }

    return Math.round(estimatedTax * 100) / 100;
  }

  private getExemptionRecommendations(
    breakdown: MonthlyBreakdown,
  ): string[] {
    const recommendations: string[] = [];

    const nonExemptLabels = breakdown.entries
      .filter(e => !e.exempt)
      .map(e => e.label);

    if (nonExemptLabels.length > 0) {
      recommendations.push(
        `Vendas acima de R$35.000 nos meses: ${nonExemptLabels.join(', ')}`,
      );
      recommendations.push(
        'DARF de ganho de capital deve ser pago até o último dia útil do mês seguinte',
      );
    }

    const exemptLabels = breakdown.entries
      .filter(e => e.exempt && e.salesVolume > 0)
      .map(e => e.label);

    if (exemptLabels.length > 0) {
      recommendations.push(
        `Meses com vendas isentas (< R$35.000): ${exemptLabels.join(', ')}`,
      );
    }

    if (breakdown.totalExemptGains > 0) {
      recommendations.push(
        `Total de ganhos isentos: R$${breakdown.totalExemptGains.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      );
    }

    return recommendations;
  }

  async calculateEstimatedTax(
    capitalGains: CapitalGainsReport,
    income: IncomeReport,
  ): Promise<number> {
    let estimatedTax = 0;

    // Convert USD gains to BRL before applying progressive brackets
    const gainsBRL = await this.toLocal(capitalGains.totalNet);

    if (gainsBRL > 0) {
      if (gainsBRL <= 5000000) { // Up to R$5M
        estimatedTax += gainsBRL * 0.15;
      } else if (gainsBRL <= 10000000) { // R$5M - R$10M
        estimatedTax += 5000000 * 0.15 + (gainsBRL - 5000000) * 0.175;
      } else if (gainsBRL <= 30000000) { // R$10M - R$30M
        estimatedTax += 5000000 * 0.15 + 5000000 * 0.175 + (gainsBRL - 10000000) * 0.20;
      } else { // Above R$30M
        estimatedTax += 5000000 * 0.15 + 5000000 * 0.175 + 20000000 * 0.20 + (gainsBRL - 30000000) * 0.225;
      }
    }

    // Income from staking, etc. taxed as regular income (convert to BRL)
    const incomeBRL = await this.toLocal(income.total);
    if (incomeBRL > 0) {
      const incomeRate = getTaxRate('BR', 'income');
      estimatedTax += incomeBRL * incomeRate;
    }

    return Math.round(estimatedTax * 100) / 100;
  }

  async generateReport(result: BeeResult, format: string): Promise<Buffer> {
    switch (format) {
      case 'IN1888':
        return this.generateIN1888(result);
      case 'GCAP':
        return this.generateGCAP(result);
      case 'DIRPF':
        return this.generateDIRPF(result);
      default:
        return this.generateGCAP(result);
    }
  }

  private async generateIN1888(result: BeeResult): Promise<Buffer> {
    const threshold = TAX_THRESHOLDS.BR.IN1888_THRESHOLD;

    const totalDisposals = await this.toLocal(result.capitalGains.shortTermGains + result.capitalGains.longTermGains);
    const netGain = await this.toLocal(result.capitalGains.totalNet);

    const lines: string[] = [
      'Instrução Normativa RFB nº 1888/2019',
      '=' .repeat(60),
      '',
      'Declaração de Operações com Criptoativos',
      '-'.repeat(40),
      '',
      `Limite de Obrigatoriedade: R$${threshold.toLocaleString('pt-BR')}`,
      '',
      'Resumo das Operações:',
      `-`.repeat(40),
      `Total de Transações: ${result.capitalGains.transactions.length}`,
      `Valor Total das Alienações: R$${totalDisposals.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `Ganho Líquido: R$${netGain.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      '',
      'Operações por Tipo:',
      '-'.repeat(40),
    ];

    // Group transactions by type and convert to BRL
    const byType = new Map<string, number>();
    for (const tx of result.capitalGains.transactions) {
      const proceedsBRL = await this.toLocal(tx.proceeds, tx.dateSold);
      const current = byType.get(tx.asset) || 0;
      byType.set(tx.asset, current + proceedsBRL);
    }

    for (const [asset, value] of byType) {
      lines.push(`  ${asset}: R$${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
    }

    lines.push(
      '',
      'Obrigações:',
      '-'.repeat(40),
      '- Informar operações mensalmente até o último dia útil do mês seguinte',
      '- Exchange brasileira: responsabilidade da exchange',
      '- Exchange estrangeira: responsabilidade do contribuinte',
      '- Custódia própria: responsabilidade do contribuinte',
    );

    return Buffer.from(lines.join('\n'));
  }

  private async generateGCAP(result: BeeResult): Promise<Buffer> {
    const lines: string[] = [
      'GCAP - Programa de Apuração de Ganhos de Capital',
      '=' .repeat(60),
      '',
      'Bens e Direitos - Criptoativos',
      '-'.repeat(40),
      '',
    ];

    for (const tx of result.capitalGains.transactions) {
      const proceedsBRL = await this.toLocal(tx.proceeds, tx.dateSold);
      const costBasisBRL = await this.toLocal(tx.costBasis, tx.dateAcquired);
      const gainLossBRL = await this.toLocal(tx.gainLoss, tx.dateSold);

      lines.push(
        `Alienação: ${tx.dateSold.toLocaleDateString('pt-BR')}`,
        `  Criptoativo: ${tx.asset}`,
        `  Data de Aquisição: ${tx.dateAcquired.toLocaleDateString('pt-BR')}`,
        `  Valor de Alienação: R$${proceedsBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `  Custo de Aquisição: R$${costBasisBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `  Ganho/Perda: R$${gainLossBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        '',
      );
    }

    const totalNetBRL = await this.toLocal(result.capitalGains.totalNet);

    lines.push(
      'Resumo:',
      '-'.repeat(40),
      `Ganho Total: R$${totalNetBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `Imposto Estimado: R$${result.estimatedTax.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      '',
      'Observações:',
      '- Vendas mensais até R$35.000 são isentas de imposto sobre ganho de capital',
      '- DARF deve ser pago até o último dia útil do mês seguinte à alienação',
      '- Código de Receita: 4600 (Ganhos de Capital)',
    );

    return Buffer.from(lines.join('\n'));
  }

  private async generateDIRPF(result: BeeResult): Promise<Buffer> {
    const lines: string[] = [
      'DIRPF - Declaração de Imposto de Renda Pessoa Física',
      '=' .repeat(60),
      '',
      'Ficha: Bens e Direitos',
      'Grupo: 08 - Criptoativos',
      '-'.repeat(40),
      '',
      'Códigos de Bens:',
      '  01 - Bitcoin (BTC)',
      '  02 - Outras criptomoedas',
      '  03 - Stablecoins',
      '  10 - NFTs',
      '  99 - Outros criptoativos',
      '',
      'Posição em 31/12:',
      '-'.repeat(40),
    ];

    for (const asset of result.holdings.assets) {
      const code = this.getAssetCode(asset.symbol);
      const costBasisBRL = await this.toLocal(asset.costBasis);
      lines.push(
        `  Código ${code} - ${asset.symbol}`,
        `    Quantidade: ${asset.balance.toFixed(8)}`,
        `    Custo de Aquisição: R$${costBasisBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        '',
      );
    }

    const totalNetBRL = await this.toLocal(result.capitalGains.totalNet);
    const stakingBRL = await this.toLocal(result.income.staking);
    const airdropsBRL = await this.toLocal(result.income.airdrops);

    lines.push(
      '',
      'Ficha: Rendimentos Isentos e Não Tributáveis',
      '-'.repeat(40),
      '  Código 05 - Ganho de capital em alienações até R$35.000/mês',
      '',
      'Ficha: Rendimentos Sujeitos à Tributação Exclusiva',
      '-'.repeat(40),
      `  Ganho de Capital: R$${totalNetBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      '',
      'Ficha: Rendimentos Tributáveis Recebidos de PJ',
      '-'.repeat(40),
      `  Staking/Rewards: R$${stakingBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `  Airdrops: R$${airdropsBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    );

    return Buffer.from(lines.join('\n'));
  }

  private getAssetCode(symbol: string): string {
    const upper = symbol.toUpperCase();
    if (upper === 'BTC' || upper === 'BITCOIN') return '01';
    if (['USDT', 'USDC', 'DAI', 'BUSD'].includes(upper)) return '03';
    return '02'; // Other crypto
  }
}

export default BRBee;
