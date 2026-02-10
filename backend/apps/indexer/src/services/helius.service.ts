import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Helius } from 'helius-sdk';

@Injectable()
export class HeliusService implements OnModuleInit {
  private readonly logger = new Logger(HeliusService.name);
  private helius: Helius;
  private rateLimit: number;
  private tokens: number;
  private lastRefill: number;

  constructor(private configService: ConfigService) {
    this.rateLimit = this.configService.get<number>('helius.rateLimit', 50);
    this.tokens = this.rateLimit;
    this.lastRefill = Date.now();
  }

  onModuleInit() {
    const apiKey = this.configService.get<string>('helius.apiKey', '');
    if (!apiKey) {
      this.logger.warn('HELIUS_API_KEY not set — Helius calls will fail');
    }
    this.helius = new Helius(apiKey);
    this.logger.log(`HeliusService initialized (rate limit: ${this.rateLimit}/s)`);
  }

  private async acquireToken(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    if (elapsed >= 1000) {
      this.tokens = this.rateLimit;
      this.lastRefill = now;
    }

    if (this.tokens <= 0) {
      const waitMs = 1000 - elapsed;
      await new Promise(resolve => setTimeout(resolve, waitMs));
      this.tokens = this.rateLimit;
      this.lastRefill = Date.now();
    }

    this.tokens--;
  }

  async getSignaturesForAddress(
    address: string,
    options?: { limit?: number; before?: string; until?: string },
  ): Promise<any[]> {
    await this.acquireToken();
    try {
      const rpcUrl = this.configService.get<string>('helius.rpcUrl', '');
      const apiKey = this.configService.get<string>('helius.apiKey', '');
      // Use Helius enhanced RPC for signatures
      const response = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${apiKey}${options?.limit ? `&limit=${options.limit}` : ''}${options?.before ? `&before=${options.before}` : ''}${options?.until ? `&until=${options.until}` : ''}`);
      if (!response.ok) {
        throw new Error(`Helius API error: ${response.status} ${response.statusText}`);
      }
      return response.json() as Promise<any[]>;
    } catch (error) {
      this.logger.error(`Failed to get signatures for ${address}: ${error}`);
      throw error;
    }
  }

  async parseTransactions(signatures: string[]): Promise<any[]> {
    const results: any[] = [];
    // Batch in chunks of 100
    for (let i = 0; i < signatures.length; i += 100) {
      await this.acquireToken();
      const chunk = signatures.slice(i, i + 100);
      try {
        const parsed = await this.helius.parseTransactions({ transactions: chunk });
        results.push(...parsed);
      } catch (error) {
        this.logger.error(`Failed to parse transactions batch at index ${i}: ${error}`);
        throw error;
      }
    }
    return results;
  }

  async getEnhancedTransactions(
    address: string,
    options?: { limit?: number; before?: string },
  ): Promise<any[]> {
    await this.acquireToken();
    try {
      const apiKey = this.configService.get<string>('helius.apiKey', '');
      const url = new URL(`https://api.helius.xyz/v0/addresses/${address}/transactions`);
      url.searchParams.set('api-key', apiKey);
      if (options?.limit) url.searchParams.set('limit', String(options.limit));
      if (options?.before) url.searchParams.set('before', options.before);

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Helius API error: ${response.status}`);
      }
      return response.json() as Promise<any[]>;
    } catch (error) {
      this.logger.error(`Failed to get enhanced transactions for ${address}: ${error}`);
      throw error;
    }
  }

  async getAsset(mint: string): Promise<any> {
    await this.acquireToken();
    try {
      const rpc = (this.helius as any).rpc ?? this.helius;
      if (typeof rpc.getAsset === 'function') {
        return rpc.getAsset({ id: mint });
      }
      // Fallback: use DAS API directly
      const apiKey = this.configService.get<string>('helius.apiKey', '');
      const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-asset',
          method: 'getAsset',
          params: { id: mint },
        }),
      });
      const data = (await response.json()) as any;
      return data.result;
    } catch (error) {
      this.logger.error(`Failed to get asset ${mint}: ${error}`);
      return null;
    }
  }

  async createWebhook(config: {
    webhookURL: string;
    accountAddresses: string[];
    transactionTypes?: string[];
    webhookType?: string;
    authHeader?: string;
  }): Promise<any> {
    await this.acquireToken();
    try {
      return this.helius.createWebhook({
        webhookURL: config.webhookURL,
        accountAddresses: config.accountAddresses,
        transactionTypes: config.transactionTypes as any[] ?? ['Any'],
        webhookType: (config.webhookType as any) ?? 'enhanced',
        authHeader: config.authHeader,
      });
    } catch (error) {
      this.logger.error(`Failed to create webhook: ${error}`);
      throw error;
    }
  }

  async updateWebhook(webhookId: string, config: {
    accountAddresses?: string[];
    webhookURL?: string;
  }): Promise<any> {
    await this.acquireToken();
    try {
      return this.helius.editWebhook(webhookId, {
        accountAddresses: config.accountAddresses,
        webhookURL: config.webhookURL,
      });
    } catch (error) {
      this.logger.error(`Failed to update webhook ${webhookId}: ${error}`);
      throw error;
    }
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.acquireToken();
    try {
      await this.helius.deleteWebhook(webhookId);
    } catch (error) {
      this.logger.error(`Failed to delete webhook ${webhookId}: ${error}`);
      throw error;
    }
  }

  async getAllWebhooks(): Promise<any[]> {
    await this.acquireToken();
    try {
      return this.helius.getAllWebhooks();
    } catch (error) {
      this.logger.error(`Failed to get webhooks: ${error}`);
      throw error;
    }
  }
}
