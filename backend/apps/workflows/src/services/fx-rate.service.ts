/**
 * FxRateService — fetches historical FX rates from Binance public klines API.
 *
 * Supports USD→BRL (via USDTBRL) and USD→EUR (via EURUSDT inverted).
 * In-memory cache keyed by "CURRENCY:YYYY-MM-DD" (daily granularity).
 * Created per audit job; cache lives for one audit run.
 */

const FALLBACK_RATES: Record<string, number> = {
  BRL: 5.8,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 150,
  AUD: 1.55,
  CAD: 1.37,
  CHF: 0.88,
  SGD: 1.35,
};

// Binance pairs: symbol → { pair, invert }
// "invert" means the pair gives "how many X per 1 USDT" so rate = close directly
// "!invert" means the pair gives "how many USDT per 1 X" so rate = 1/close
const PAIR_CONFIG: Record<string, { pair: string; invert: boolean }> = {
  BRL: { pair: 'USDTBRL', invert: false },   // USDTBRL = BRL per 1 USDT → multiply USD by close
  EUR: { pair: 'EURUSDT', invert: true },     // EURUSDT = USDT per 1 EUR → divide USD by close
  GBP: { pair: 'GBPUSDT', invert: true },     // GBPUSDT = USDT per 1 GBP → divide USD by close
  JPY: { pair: 'USDTJPY', invert: false },    // USDTJPY = JPY per 1 USDT → multiply
  AUD: { pair: 'AUDUSDT', invert: true },     // AUDUSDT = USDT per 1 AUD → divide
  TRY: { pair: 'USDTTRY', invert: false },    // USDTTRY = TRY per 1 USDT → multiply
};

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

export class FxRateService {
  private cache = new Map<string, number>();

  /**
   * Get the rate to convert 1 USD into the target currency on a given date.
   * Returns the multiplier: localAmount = amountUsd * rate.
   */
  async getRate(currency: string, date?: Date): Promise<number> {
    const upper = currency.toUpperCase();
    if (upper === 'USD') return 1;

    const d = date ?? new Date();
    const key = `${upper}:${dateKey(d)}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const rate = await this.fetchRate(upper, d);
    this.cache.set(key, rate);
    return rate;
  }

  /**
   * Convert a USD amount to the target currency at the given date's rate.
   */
  async convert(amountUsd: number, currency: string, date?: Date): Promise<number> {
    const rate = await this.getRate(currency, date);
    return amountUsd * rate;
  }

  private async fetchRate(currency: string, date: Date): Promise<number> {
    const config = PAIR_CONFIG[currency];
    if (!config) {
      return FALLBACK_RATES[currency] ?? 1;
    }

    const startOfDay = new Date(date);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

    const url = `https://api.binance.com/api/v3/klines?symbol=${config.pair}&interval=1d&startTime=${startOfDay.getTime()}&endTime=${endOfDay.getTime()}&limit=1`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) return FALLBACK_RATES[currency] ?? 1;

      const data = await resp.json();
      if (Array.isArray(data) && data.length > 0) {
        const close = parseFloat(data[0][4]);
        if (close > 0) {
          // invert=false: pair is USDTxxx → close IS the rate (xxx per 1 USD)
          // invert=true:  pair is xxxUSDT → close is USD per 1 xxx → rate = 1/close
          return config.invert ? 1 / close : close;
        }
      }
    } catch {
      // Fall through to fallback
    }

    await delay(50);
    return FALLBACK_RATES[currency] ?? 1;
  }
}
