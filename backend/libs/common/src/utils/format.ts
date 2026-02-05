/**
 * Format currency value
 */
export function formatCurrency(
  amount: number,
  currency = 'USD',
  locale = 'en-US',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format crypto amount with appropriate decimals
 */
export function formatCryptoAmount(
  amount: bigint | number,
  decimals: number,
  maxDisplayDecimals = 6,
): string {
  const num = typeof amount === 'bigint'
    ? Number(amount) / Math.pow(10, decimals)
    : amount;

  if (num === 0) return '0';

  if (Math.abs(num) < 0.000001) {
    return num.toExponential(4);
  }

  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDisplayDecimals,
  });
}

/**
 * Format percentage
 */
export function formatPercentage(value: number, decimals = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format large numbers with suffixes (K, M, B)
 */
export function formatCompactNumber(num: number): string {
  if (Math.abs(num) >= 1e9) {
    return (num / 1e9).toFixed(2) + 'B';
  }
  if (Math.abs(num) >= 1e6) {
    return (num / 1e6).toFixed(2) + 'M';
  }
  if (Math.abs(num) >= 1e3) {
    return (num / 1e3).toFixed(2) + 'K';
  }
  return num.toFixed(2);
}

/**
 * Format gain/loss with color indicator
 */
export function formatGainLoss(amount: number, currency = 'USD'): {
  formatted: string;
  isGain: boolean;
  isLoss: boolean;
} {
  const isGain = amount > 0;
  const isLoss = amount < 0;
  const prefix = isGain ? '+' : '';

  return {
    formatted: prefix + formatCurrency(amount, currency),
    isGain,
    isLoss,
  };
}

/**
 * Sanitize string for safe display
 */
export function sanitize(str: string): string {
  return str
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .trim();
}

/**
 * Generate a slug from a string
 */
export function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Convert lamports to SOL
 */
export function lamportsToSol(lamports: bigint | number): number {
  const value = typeof lamports === 'bigint' ? Number(lamports) : lamports;
  return value / 1e9;
}

/**
 * Convert SOL to lamports
 */
export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * 1e9));
}
