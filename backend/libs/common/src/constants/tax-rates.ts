import type { JurisdictionCode, TaxRate } from '../types/jurisdiction';

export const TAX_RATES: Record<JurisdictionCode, TaxRate[]> = {
  US: [
    // Short-term capital gains (ordinary income rates)
    { type: 'capital_gains_short', rate: 0.10, bracket: { min: 0, max: 11000 } },
    { type: 'capital_gains_short', rate: 0.12, bracket: { min: 11001, max: 44725 } },
    { type: 'capital_gains_short', rate: 0.22, bracket: { min: 44726, max: 95375 } },
    { type: 'capital_gains_short', rate: 0.24, bracket: { min: 95376, max: 183250 } },
    { type: 'capital_gains_short', rate: 0.32, bracket: { min: 183251, max: 231250 } },
    { type: 'capital_gains_short', rate: 0.35, bracket: { min: 231251, max: 578125 } },
    { type: 'capital_gains_short', rate: 0.37, bracket: { min: 578126, max: Infinity } },
    // Long-term capital gains
    { type: 'capital_gains_long', rate: 0.0, bracket: { min: 0, max: 44625 }, holdingPeriod: 366 },
    { type: 'capital_gains_long', rate: 0.15, bracket: { min: 44626, max: 492300 }, holdingPeriod: 366 },
    { type: 'capital_gains_long', rate: 0.20, bracket: { min: 492301, max: Infinity }, holdingPeriod: 366 },
    // Staking/Mining treated as income
    { type: 'staking', rate: 0.22 }, // Average estimate
    { type: 'mining', rate: 0.22 },
  ],
  EU: [
    // Simplified EU rates (varies by country)
    { type: 'capital_gains_short', rate: 0.25 },
    { type: 'capital_gains_long', rate: 0.25, holdingPeriod: 366 },
    { type: 'income', rate: 0.30 },
    { type: 'staking', rate: 0.30 },
    { type: 'mining', rate: 0.30 },
  ],
  BR: [
    // Brazil progressive rates for crypto gains above R$35,000/month exempt threshold
    { type: 'capital_gains_short', rate: 0.15, bracket: { min: 0, max: 5000000 } }, // Up to 5M
    { type: 'capital_gains_short', rate: 0.175, bracket: { min: 5000001, max: 10000000 } },
    { type: 'capital_gains_short', rate: 0.20, bracket: { min: 10000001, max: 30000000 } },
    { type: 'capital_gains_short', rate: 0.225, bracket: { min: 30000001, max: Infinity } },
    { type: 'capital_gains_long', rate: 0.15 }, // Same rates apply
    { type: 'income', rate: 0.275 }, // Max income tax rate
    { type: 'staking', rate: 0.275 },
    { type: 'mining', rate: 0.275 },
  ],
  UK: [
    // UK CGT rates
    { type: 'capital_gains_short', rate: 0.10, bracket: { min: 0, max: 37700 } },
    { type: 'capital_gains_short', rate: 0.20, bracket: { min: 37701, max: Infinity } },
    { type: 'capital_gains_long', rate: 0.10, bracket: { min: 0, max: 37700 } },
    { type: 'capital_gains_long', rate: 0.20, bracket: { min: 37701, max: Infinity } },
    { type: 'staking', rate: 0.40 },
    { type: 'mining', rate: 0.40 },
  ],
  JP: [
    // Japan - crypto gains taxed as miscellaneous income
    { type: 'capital_gains_short', rate: 0.55 }, // Max rate
    { type: 'capital_gains_long', rate: 0.55 },
    { type: 'income', rate: 0.55 },
    { type: 'staking', rate: 0.55 },
    { type: 'mining', rate: 0.55 },
  ],
  AU: [
    // Australia CGT with 50% discount for holdings >12 months
    { type: 'capital_gains_short', rate: 0.45 }, // Max marginal rate
    { type: 'capital_gains_long', rate: 0.225, holdingPeriod: 366 }, // 50% discount
    { type: 'staking', rate: 0.45 },
    { type: 'mining', rate: 0.45 },
  ],
  CA: [
    // Canada - 50% inclusion rate for capital gains
    { type: 'capital_gains_short', rate: 0.265 }, // ~53% max rate * 50% inclusion
    { type: 'capital_gains_long', rate: 0.265 },
    { type: 'income', rate: 0.53 },
    { type: 'staking', rate: 0.53 },
    { type: 'mining', rate: 0.53 },
  ],
  CH: [
    // Switzerland - generally no capital gains tax for individuals
    { type: 'capital_gains_short', rate: 0 },
    { type: 'capital_gains_long', rate: 0 },
    { type: 'income', rate: 0.40 }, // Mining/professional trading
    { type: 'staking', rate: 0.40 },
    { type: 'mining', rate: 0.40 },
  ],
  SG: [
    // Singapore - no capital gains tax
    { type: 'capital_gains_short', rate: 0 },
    { type: 'capital_gains_long', rate: 0 },
    { type: 'income', rate: 0.22 }, // Trading as business
    { type: 'staking', rate: 0.22 },
    { type: 'mining', rate: 0.22 },
  ],
};

// Thresholds and exemptions
export const TAX_THRESHOLDS: Record<JurisdictionCode, Record<string, number>> = {
  US: {
    FBAR_THRESHOLD: 10000, // USD
    FORM_8938_THRESHOLD: 50000, // USD for US residents
    WASH_SALE_DAYS: 30, // Not currently enforced for crypto
  },
  EU: {
    TRAVEL_RULE_THRESHOLD: 1000, // EUR
    DAC8_THRESHOLD: 0, // All transactions reported
  },
  BR: {
    MONTHLY_EXEMPT_THRESHOLD: 35000, // BRL - sales below exempt from gains
    IN1888_THRESHOLD: 30000, // BRL - reporting threshold
  },
  UK: {
    CGT_ANNUAL_EXEMPT: 6000, // GBP for 2023/24
    TRADING_ALLOWANCE: 1000, // GBP
  },
  JP: {
    MISCELLANEOUS_DEDUCTION: 200000, // JPY
  },
  AU: {
    CGT_DISCOUNT_HOLDING_PERIOD: 365, // Days for 50% discount
    PERSONAL_USE_THRESHOLD: 10000, // AUD
  },
  CA: {
    T1135_THRESHOLD: 100000, // CAD foreign property
  },
  CH: {
    WEALTH_TAX_THRESHOLD: 0, // All assets subject to wealth tax
  },
  SG: {
    TRADING_INCOME_THRESHOLD: 0, // No specific threshold
  },
};

/**
 * Get applicable tax rate for a jurisdiction and type
 */
export function getTaxRate(
  jurisdiction: JurisdictionCode,
  type: TaxRate['type'],
  amount?: number,
  holdingPeriod?: number,
): number {
  const rates = TAX_RATES[jurisdiction].filter(r => r.type === type);

  if (rates.length === 0) return 0;

  // If holding period matters, filter by it
  if (holdingPeriod !== undefined) {
    const longTermRates = rates.filter(r => r.holdingPeriod && holdingPeriod >= r.holdingPeriod);
    if (longTermRates.length > 0) {
      return findRateForAmount(longTermRates, amount);
    }
  }

  // Find rate for amount bracket
  return findRateForAmount(rates, amount);
}

function findRateForAmount(rates: TaxRate[], amount?: number): number {
  if (amount === undefined || rates.length === 1) {
    return rates[0].rate;
  }

  const bracketRate = rates.find(r =>
    r.bracket && amount >= r.bracket.min && amount <= r.bracket.max
  );

  return bracketRate?.rate ?? rates[rates.length - 1].rate;
}
