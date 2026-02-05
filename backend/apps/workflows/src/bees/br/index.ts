import { BaseBee, BeeResult, BeeOptions } from '../base';
import { getTaxRate, TAX_THRESHOLDS } from '@auditswarm/common';
import type { CapitalGainsReport, IncomeReport, JurisdictionCode, Transaction } from '@auditswarm/common';

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
  ): Promise<BeeResult> {
    // Call base process first
    const result = await super.process(transactions, taxYear, options);

    // Add Brazil-specific monthly exemption analysis
    const monthlyExemption = await this.calculateMonthlyExemptions(transactions, taxYear);

    // Adjust result based on exemptions
    result.recommendations.push(
      ...this.getExemptionRecommendations(monthlyExemption),
    );

    return result;
  }

  /**
   * Calculate monthly sales and exemptions
   * Sales below R$35,000/month are exempt from capital gains tax
   */
  async calculateMonthlyExemptions(
    transactions: Transaction[],
    taxYear: number,
  ): Promise<Map<number, { sales: number; exempt: boolean }>> {
    const threshold = TAX_THRESHOLDS.BR.MONTHLY_EXEMPT_THRESHOLD;
    const monthlyData = new Map<number, { sales: number; exempt: boolean }>();

    // Initialize all months
    for (let month = 0; month < 12; month++) {
      monthlyData.set(month, { sales: 0, exempt: true });
    }

    // Sum sales by month
    const sales = transactions.filter(tx =>
      tx.type === 'SELL' &&
      tx.timestamp.getFullYear() === taxYear,
    );

    for (const tx of sales) {
      const month = tx.timestamp.getMonth();
      const current = monthlyData.get(month)!;

      // Convert USD to BRL (approximate)
      const valueBRL = Number(tx.totalValueUsd ?? 0) * 5.0; // Approximate rate
      current.sales += valueBRL;
      current.exempt = current.sales <= threshold;

      monthlyData.set(month, current);
    }

    return monthlyData;
  }

  private getExemptionRecommendations(
    monthlyData: Map<number, { sales: number; exempt: boolean }>,
  ): string[] {
    const recommendations: string[] = [];
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    const nonExemptMonths = Array.from(monthlyData.entries())
      .filter(([_, data]) => !data.exempt)
      .map(([month]) => months[month]);

    if (nonExemptMonths.length > 0) {
      recommendations.push(
        `Vendas acima de R$35.000 nos meses: ${nonExemptMonths.join(', ')}`,
      );
      recommendations.push(
        'DARF de ganho de capital deve ser pago até o último dia útil do mês seguinte',
      );
    }

    const exemptMonths = Array.from(monthlyData.entries())
      .filter(([_, data]) => data.exempt && data.sales > 0)
      .map(([month]) => months[month]);

    if (exemptMonths.length > 0) {
      recommendations.push(
        `Meses com vendas isentas (< R$35.000): ${exemptMonths.join(', ')}`,
      );
    }

    return recommendations;
  }

  async calculateEstimatedTax(
    capitalGains: CapitalGainsReport,
    income: IncomeReport,
  ): Promise<number> {
    let estimatedTax = 0;

    // Brazil progressive rates for capital gains
    const gains = capitalGains.totalNet;

    if (gains > 0) {
      if (gains <= 5000000) { // Up to R$5M
        estimatedTax += gains * 0.15;
      } else if (gains <= 10000000) { // R$5M - R$10M
        estimatedTax += 5000000 * 0.15 + (gains - 5000000) * 0.175;
      } else if (gains <= 30000000) { // R$10M - R$30M
        estimatedTax += 5000000 * 0.15 + 5000000 * 0.175 + (gains - 10000000) * 0.20;
      } else { // Above R$30M
        estimatedTax += 5000000 * 0.15 + 5000000 * 0.175 + 20000000 * 0.20 + (gains - 30000000) * 0.225;
      }
    }

    // Income from staking, etc. taxed as regular income
    if (income.total > 0) {
      const incomeRate = getTaxRate('BR', 'income');
      estimatedTax += income.total * incomeRate;
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
        throw new Error(`Formato não suportado: ${format}`);
    }
  }

  private async generateIN1888(result: BeeResult): Promise<Buffer> {
    const threshold = TAX_THRESHOLDS.BR.IN1888_THRESHOLD;

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
      `Valor Total das Alienações: R$${(result.capitalGains.shortTermGains + result.capitalGains.longTermGains).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `Ganho Líquido: R$${result.capitalGains.totalNet.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      '',
      'Operações por Tipo:',
      '-'.repeat(40),
    ];

    // Group transactions by type
    const byType = new Map<string, number>();
    for (const tx of result.capitalGains.transactions) {
      const current = byType.get(tx.asset) || 0;
      byType.set(tx.asset, current + tx.proceeds);
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
      lines.push(
        `Alienação: ${tx.dateSold.toLocaleDateString('pt-BR')}`,
        `  Criptoativo: ${tx.asset}`,
        `  Data de Aquisição: ${tx.dateAcquired.toLocaleDateString('pt-BR')}`,
        `  Valor de Alienação: R$${tx.proceeds.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `  Custo de Aquisição: R$${tx.costBasis.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `  Ganho/Perda: R$${tx.gainLoss.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        '',
      );
    }

    lines.push(
      'Resumo:',
      '-'.repeat(40),
      `Ganho Total: R$${result.capitalGains.totalNet.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
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
      lines.push(
        `  Código ${code} - ${asset.symbol}`,
        `    Quantidade: ${asset.balance.toFixed(8)}`,
        `    Custo de Aquisição: R$${asset.costBasis.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        '',
      );
    }

    lines.push(
      '',
      'Ficha: Rendimentos Isentos e Não Tributáveis',
      '-'.repeat(40),
      '  Código 05 - Ganho de capital em alienações até R$35.000/mês',
      '',
      'Ficha: Rendimentos Sujeitos à Tributação Exclusiva',
      '-'.repeat(40),
      `  Ganho de Capital: R$${result.capitalGains.totalNet.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      '',
      'Ficha: Rendimentos Tributáveis Recebidos de PJ',
      '-'.repeat(40),
      `  Staking/Rewards: R$${result.income.staking.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `  Airdrops: R$${result.income.airdrops.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
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
