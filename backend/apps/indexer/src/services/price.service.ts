import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface PriceRequest {
  mint: string;
  timestamp: number; // unix seconds
  chain?: string;    // birdeye chain: solana, bsc, ethereum, etc.
}

/**
 * Maps exchange pseudo-mints (exchange:bnb) to Birdeye-compatible chain + address.
 * Uses wrapped native tokens where Birdeye expects contract addresses.
 */
const EXCHANGE_MINT_MAP: Record<string, { chain: string; address: string }> = {
  // BSC
  'exchange:bnb':  { chain: 'bsc',      address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' }, // WBNB
  'exchange:cake': { chain: 'bsc',      address: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82' },
  'exchange:busd': { chain: 'bsc',      address: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56' },
  // Ethereum
  'exchange:eth':  { chain: 'ethereum', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }, // WETH
  'exchange:wbtc': { chain: 'ethereum', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' },
  'exchange:link': { chain: 'ethereum', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA' },
  'exchange:shib': { chain: 'ethereum', address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE' },
  // Binance internal
  'binance:BNB':   { chain: 'bsc',      address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
  'binance:BETH':  { chain: 'ethereum', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  // Polygon
  'exchange:matic': { chain: 'polygon', address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' }, // WMATIC
  'exchange:pol':   { chain: 'polygon', address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270' },
  // Avalanche
  'exchange:avax': { chain: 'avalanche', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' }, // WAVAX
  // Arbitrum
  'exchange:arb':  { chain: 'arbitrum', address: '0x912CE59144191C1204E64559FE8253a0e49E6548' },
};

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

  /**
   * Resolve a mint to Birdeye-compatible chain + address.
   * For exchange pseudo-mints, maps to the real chain address.
   * For Solana mints, uses solana chain.
   */
  resolveForBirdeye(mint: string): { chain: string; address: string } | null {
    // Direct lookup for known exchange/binance mints
    const mapped = EXCHANGE_MINT_MAP[mint] ?? EXCHANGE_MINT_MAP[mint.toLowerCase()];
    if (mapped) return mapped;

    // Skip fiat, native pseudo-mints
    if (mint === 'native' || mint.startsWith('fiat:')) return null;

    // Unknown exchange:* mints — can't resolve
    if (mint.startsWith('exchange:') || mint.startsWith('binance:')) return null;

    // EVM addresses (0x...) — might be on any chain, skip for safety
    if (mint.startsWith('0x')) return null;

    // Assume Solana for base58 addresses
    return { chain: 'solana', address: mint };
  }

  async getHistoricalPrice(mint: string, timestamp: number, chain?: string): Promise<number | null> {
    const cacheKey = this.getCacheKey(mint, timestamp);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // Resolve mint to Birdeye-compatible format
    let birdeyeChain = chain ?? 'solana';
    let birdeyeAddress = mint;

    const resolved = this.resolveForBirdeye(mint);
    if (!resolved) return null;
    birdeyeChain = chain ?? resolved.chain;
    birdeyeAddress = resolved.address;

    await this.acquireToken();

    try {
      const apiKey = this.configService.get<string>('BIRDEYE_API_KEY', '');
      const timeFrom = timestamp;
      const timeTo = timestamp + 60;

      const response = await firstValueFrom(
        this.httpService.get(`${this.BIRDEYE_BASE}/defi/history_price`, {
          params: {
            address: birdeyeAddress,
            address_type: 'token',
            type: '1m',
            time_from: timeFrom,
            time_to: timeTo,
          },
          headers: {
            'X-API-KEY': apiKey,
            'x-chain': birdeyeChain,
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

      // Fallback: try 5m window
      const response2 = await firstValueFrom(
        this.httpService.get(`${this.BIRDEYE_BASE}/defi/history_price`, {
          params: {
            address: birdeyeAddress,
            address_type: 'token',
            type: '5m',
            time_from: timestamp - 300,
            time_to: timestamp + 300,
          },
          headers: {
            'X-API-KEY': apiKey,
            'x-chain': birdeyeChain,
            accept: 'application/json',
          },
        }),
      );

      const items2 = response2.data?.data?.items ?? [];
      if (items2.length > 0) {
        const price = items2[0].value;
        this.cache.set(cacheKey, price);
        return price;
      }

      return null;
    } catch (error) {
      this.logger.warn(`Price lookup failed for ${mint} (${birdeyeChain}:${birdeyeAddress}) at ${timestamp}: ${error}`);
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
      const price = await this.getHistoricalPrice(req.mint, req.timestamp, req.chain);
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
    chain?: string,
  ): Promise<number | null> {
    const price = await this.getHistoricalPrice(mint, timestamp, chain);
    if (price === null) return null;
    return price * amount;
  }
}
