import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { TokenSymbolMapping, Prisma } from '@prisma/client';

@Injectable()
export class TokenSymbolMappingRepository {
  constructor(private prisma: PrismaService) {}

  async findBySymbolAndNetwork(
    symbol: string,
    network: string,
  ): Promise<TokenSymbolMapping | null> {
    return this.prisma.tokenSymbolMapping.findUnique({
      where: { symbol_network: { symbol: symbol.toUpperCase(), network } },
    });
  }

  async findBySymbol(symbol: string): Promise<TokenSymbolMapping | null> {
    const upper = symbol.toUpperCase();

    // Try default first
    const defaultMapping = await this.prisma.tokenSymbolMapping.findFirst({
      where: { symbol: upper, isDefault: true },
    });
    if (defaultMapping) return defaultMapping;

    // Fall back to first match
    return this.prisma.tokenSymbolMapping.findFirst({
      where: { symbol: upper },
    });
  }

  /**
   * Resolve a symbol to a mint address.
   * Returns the mint if found, otherwise returns `exchange:{SYMBOL}` pseudo-mint.
   */
  async resolveToMint(
    symbol: string,
    network?: string,
  ): Promise<{ mint: string; decimals: number }> {
    const mapping = network
      ? await this.findBySymbolAndNetwork(symbol, network)
      : await this.findBySymbol(symbol);

    if (mapping) {
      return { mint: mapping.mint, decimals: mapping.decimals };
    }

    // Pseudo-mint for unresolved symbols
    return { mint: `exchange:${symbol.toUpperCase()}`, decimals: 8 };
  }

  async upsert(
    data: Prisma.TokenSymbolMappingCreateInput,
  ): Promise<TokenSymbolMapping> {
    return this.prisma.tokenSymbolMapping.upsert({
      where: {
        symbol_network: {
          symbol: data.symbol.toUpperCase(),
          network: data.network,
        },
      },
      create: { ...data, symbol: data.symbol.toUpperCase() },
      update: {
        mint: data.mint,
        decimals: data.decimals,
        source: data.source,
        isDefault: data.isDefault,
      },
    });
  }

  async findAll(): Promise<TokenSymbolMapping[]> {
    return this.prisma.tokenSymbolMapping.findMany({
      orderBy: { symbol: 'asc' },
    });
  }

  async findByMint(mint: string): Promise<TokenSymbolMapping | null> {
    return this.prisma.tokenSymbolMapping.findFirst({
      where: { mint },
    });
  }
}
