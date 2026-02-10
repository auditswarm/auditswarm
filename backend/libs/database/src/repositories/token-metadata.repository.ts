import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { TokenMetadata, Prisma } from '@prisma/client';

@Injectable()
export class TokenMetadataRepository {
  constructor(private prisma: PrismaService) {}

  async upsert(
    mint: string,
    data: Partial<Omit<Prisma.TokenMetadataCreateInput, 'mint'>>,
  ): Promise<TokenMetadata> {
    return this.prisma.tokenMetadata.upsert({
      where: { mint },
      create: { mint, ...data } as Prisma.TokenMetadataCreateInput,
      update: data,
    });
  }

  async findByMint(mint: string): Promise<TokenMetadata | null> {
    return this.prisma.tokenMetadata.findUnique({ where: { mint } });
  }

  async findByMints(mints: string[]): Promise<TokenMetadata[]> {
    return this.prisma.tokenMetadata.findMany({
      where: { mint: { in: mints } },
    });
  }

  async findAll(): Promise<TokenMetadata[]> {
    return this.prisma.tokenMetadata.findMany({
      orderBy: { symbol: 'asc' },
    });
  }
}
