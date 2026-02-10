import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface PriceRequest {
  mint: string;
  timestamp: number; // unix seconds
}

@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);
  private readonly cache = new Map<string, number>();
  private readonly BIRDEYE_BASE = 'https://public-api.birdeye.so';
  private tokens = 100;
  private lastRefill = Date.now();

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  private getCacheKey(mint: string, timestamp: number): string {
    // Round to hour for cache key — historical prices are immutable
    const hourTs = Math.floor(timestamp / 3600) * 3600;
    return `${mint}:${hourTs}`;
  }

  private async acquireToken(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed >= 1000) {
      this.tokens = 100;
      this.lastRefill = now;
    }
    if (this.tokens <= 0) {
      await new Promise(resolve => setTimeout(resolve, 1000 - elapsed));
      this.tokens = 100;
      this.lastRefill = Date.now();
    }
    this.tokens--;
  }

  async getHistoricalPrice(mint: string, timestamp: number): Promise<number | null> {
    const cacheKey = this.getCacheKey(mint, timestamp);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    await this.acquireToken();

    try {
      const apiKey = this.configService.get<string>('BIRDEYE_API_KEY', '');
      const timeFrom = timestamp;
      const timeTo = timestamp + 60;

      const response = await firstValueFrom(
        this.httpService.get(`${this.BIRDEYE_BASE}/defi/history_price`, {
          params: {
            address: mint,
            address_type: 'token',
            type: '1m',
            time_from: timeFrom,
            time_to: timeTo,
          },
          headers: {
            'X-API-KEY': apiKey,
            accept: 'application/json',
          },
        }),
      );

      const items = response.data?.data?.items ?? [];
      if (items.length > 0) {
        const price = items[0].value;
        this.cache.set(cacheKey, price);
        return price;
      }

      return null;
    } catch (error) {
      this.logger.warn(`Price lookup failed for ${mint} at ${timestamp}: ${error}`);
      return null;
    }
  }

  async getBatchHistoricalPrices(
    requests: PriceRequest[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    // Deduplicate by mint + hour
    const unique = new Map<string, PriceRequest>();
    for (const req of requests) {
      const key = this.getCacheKey(req.mint, req.timestamp);
      if (!unique.has(key)) {
        unique.set(key, req);
      }
    }

    // Check cache first
    const uncached: PriceRequest[] = [];
    for (const [key, req] of unique) {
      if (this.cache.has(key)) {
        result.set(key, this.cache.get(key)!);
      } else {
        uncached.push(req);
      }
    }

    // Fetch uncached prices
    for (const req of uncached) {
      const price = await this.getHistoricalPrice(req.mint, req.timestamp);
      if (price !== null) {
        const key = this.getCacheKey(req.mint, req.timestamp);
        result.set(key, price);
      }
    }

    return result;
  }

  /**
   * Get price for a specific transfer. Returns the USD value.
   */
  async getTransferValue(
    mint: string,
    amount: number,
    timestamp: number,
  ): Promise<number | null> {
    const price = await this.getHistoricalPrice(mint, timestamp);
    if (price === null) return null;
    return price * amount;
  }
}
