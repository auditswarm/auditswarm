/**
 * Get the tax year for a given date and jurisdiction
 */
export function getTaxYear(date: Date, jurisdiction: string): number {
  const year = date.getFullYear();
  const month = date.getMonth();

  // Some jurisdictions have fiscal years that don't align with calendar year
  switch (jurisdiction) {
    case 'UK':
    case 'AU':
      // UK/AU tax year: April 6 - April 5
      return month >= 3 && date.getDate() >= 6 ? year : year - 1;
    case 'JP':
      // Japan tax year: April 1 - March 31
      return month >= 3 ? year : year - 1;
    default:
      // Most jurisdictions use calendar year
      return year;
  }
}

/**
 * Get tax year date range for a jurisdiction
 */
export function getTaxYearRange(
  year: number,
  jurisdiction: string,
): { start: Date; end: Date } {
  switch (jurisdiction) {
    case 'UK':
    case 'AU':
      return {
        start: new Date(year, 3, 6), // April 6
        end: new Date(year + 1, 3, 5, 23, 59, 59), // April 5 next year
      };
    case 'JP':
      return {
        start: new Date(year, 3, 1), // April 1
        end: new Date(year + 1, 2, 31, 23, 59, 59), // March 31 next year
      };
    default:
      return {
        start: new Date(year, 0, 1), // January 1
        end: new Date(year, 11, 31, 23, 59, 59), // December 31
      };
  }
}

/**
 * Calculate holding period in days
 */
export function calculateHoldingPeriod(
  acquisitionDate: Date,
  disposalDate: Date,
): number {
  const diffTime = disposalDate.getTime() - acquisitionDate.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Check if a holding qualifies for long-term capital gains
 */
export function isLongTermHolding(
  acquisitionDate: Date,
  disposalDate: Date,
  jurisdiction: string,
): boolean {
  const holdingDays = calculateHoldingPeriod(acquisitionDate, disposalDate);

  switch (jurisdiction) {
    case 'US':
      return holdingDays > 365; // More than 1 year
    case 'BR':
      return holdingDays > 365; // More than 1 year (different rates)
    case 'EU':
      // Varies by country, default to 1 year
      return holdingDays > 365;
    default:
      return holdingDays > 365;
  }
}

/**
 * Format date for display in a specific locale
 */
export function formatDate(date: Date, locale = 'en-US'): string {
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Parse a date string in various formats
 */
export function parseDate(dateStr: string): Date | null {
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Get Unix timestamp in seconds
 */
export function unixTimestamp(date: Date = new Date()): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Convert Unix timestamp to Date
 */
export function fromUnixTimestamp(timestamp: number): Date {
  return new Date(timestamp * 1000);
}
