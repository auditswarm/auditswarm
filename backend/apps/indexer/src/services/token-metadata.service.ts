import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { TokenMetadataRepository } from '@auditswarm/database';
import { HeliusService } from './helius.service';
import { firstValueFrom } from 'rxjs';

export interface TokenInfo {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string;
  isVerified?: boolean;
}

// Native SOL
const NATIVE_SOL: TokenInfo = {
  mint: 'So11111111111111111111111111111111111111112',
  symbol: 'SOL',
  name: 'Solana',
  decimals: 9,
  isVerified: true,
};

@Injectable()
export class TokenMetadataService implements OnModuleInit {
  private readonly logger = new Logger(TokenMetadataService.name);
  private jupiterTokens = new Map<string, TokenInfo>();
  private memoryCache = new Map<string, TokenInfo>();
  private lastJupiterRefresh = 0;
  private readonly JUPITER_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24h

  constructor(
    private tokenMetadataRepo: TokenMetadataRepository,
    private heliusService: HeliusService,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    // Pre-cache native SOL
    this.memoryCache.set(NATIVE_SOL.mint, NATIVE_SOL);
  }

  async onModuleInit() {
    await this.loadJupiterTokenList();
  }

  private async loadJupiterTokenList(): Promise<void> {
    try {
      const apiKey = this.configService.get<string>('JUPITER_API_KEY', '');
      const headers: Record<string, string> = { accept: 'application/json' };
      if (apiKey) {
        headers['x-api-key'] = apiKey;
      }

      // Jupiter Tokens API v2: https://dev.jup.ag/docs/tokens/v2
      const response = await firstValueFrom(
        this.httpService.get('https://api.jup.ag/tokens/v2/tag', {
          params: { query: 'verified' },
          headers,
        }),
      );
      const tokens = response.data;
      if (Array.isArray(tokens)) {
        for (const token of tokens) {
          const info: TokenInfo = {
            mint: token.address ?? token.mint,
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            logoUrl: token.logoURI ?? token.logo_uri,
            isVerified: true,
          };
          this.jupiterTokens.set(info.mint, info);
        }
        this.lastJupiterRefresh = Date.now();
        this.logger.log(`Loaded ${this.jupiterTokens.size} tokens from Jupiter`);
      }
    } catch (error) {
      this.logger.warn(`Failed to load Jupiter token list: ${error}`);
    }
  }

  private async refreshJupiterIfStale(): Promise<void> {
    if (Date.now() - this.lastJupiterRefresh > this.JUPITER_REFRESH_INTERVAL) {
      await this.loadJupiterTokenList();
    }
  }

  async ensureMetadata(mints: string[]): Promise<Map<string, TokenInfo>> {
    const result = new Map<string, TokenInfo>();
    const missing: string[] = [];

    for (const mint of mints) {
      // Check memory cache first
      const cached = this.memoryCache.get(mint);
      if (cached) {
        result.set(mint, cached);
        continue;
      }
      missing.push(mint);
    }

    if (missing.length === 0) return result;

    // Check DB cache
    const dbRecords = await this.tokenMetadataRepo.findByMints(missing);
    const stillMissing: string[] = [];

    for (const record of dbRecords) {
      const info: TokenInfo = {
        mint: record.mint,
        symbol: record.symbol ?? 'UNKNOWN',
        name: record.name ?? 'Unknown Token',
        decimals: record.decimals,
        logoUrl: record.logoUrl ?? undefined,
        isVerified: record.isVerified,
      };
      this.memoryCache.set(record.mint, info);
      result.set(record.mint, info);
    }

    const foundMints = new Set(dbRecords.map(r => r.mint));
    for (const mint of missing) {
      if (!foundMints.has(mint)) {
        stillMissing.push(mint);
      }
    }

    if (stillMissing.length === 0) return result;

    // Refresh Jupiter if needed
    await this.refreshJupiterIfStale();

    // Try Jupiter list
    const jupiterMissing: string[] = [];
    for (const mint of stillMissing) {
      const jupToken = this.jupiterTokens.get(mint);
      if (jupToken) {
        this.memoryCache.set(mint, jupToken);
        result.set(mint, jupToken);
        // Persist to DB
        await this.tokenMetadataRepo.upsert(mint, {
          symbol: jupToken.symbol,
          name: jupToken.name,
          decimals: jupToken.decimals,
          logoUrl: jupToken.logoUrl,
          source: 'JUPITER',
          isVerified: true,
        });
      } else {
        jupiterMissing.push(mint);
      }
    }

    // Fallback to Helius DAS for remaining
    for (const mint of jupiterMissing) {
      try {
        const asset = await this.heliusService.getAsset(mint);
        if (asset) {
          const info: TokenInfo = {
            mint,
            symbol: asset.content?.metadata?.symbol ?? 'UNKNOWN',
            name: asset.content?.metadata?.name ?? 'Unknown Token',
            decimals: asset.token_info?.decimals ?? 0,
            logoUrl: asset.content?.links?.image,
            isVerified: false,
          };
          this.memoryCache.set(mint, info);
          result.set(mint, info);
          await this.tokenMetadataRepo.upsert(mint, {
            symbol: info.symbol,
            name: info.name,
            decimals: info.decimals,
            logoUrl: info.logoUrl,
            source: 'HELIUS_DAS',
            isVerified: false,
          });
        } else {
          // Create a placeholder
          const placeholder: TokenInfo = {
            mint,
            symbol: 'UNKNOWN',
            name: 'Unknown Token',
            decimals: 0,
            isVerified: false,
          };
          this.memoryCache.set(mint, placeholder);
          result.set(mint, placeholder);
        }
      } catch (error) {
        this.logger.warn(`Failed to get metadata for ${mint}: ${error}`);
        result.set(mint, { mint, symbol: 'UNKNOWN', name: 'Unknown Token', decimals: 0 });
      }
    }

    return result;
  }

  getFromCache(mint: string): TokenInfo | undefined {
    return this.memoryCache.get(mint);
  }
}
