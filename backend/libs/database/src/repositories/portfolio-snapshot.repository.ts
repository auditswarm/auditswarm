import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { PortfolioSnapshot, Prisma } from '@prisma/client';

@Injectable()
export class PortfolioSnapshotRepository {
  constructor(private prisma: PrismaService) {}

  async upsert(
    userId: string,
    mint: string,
    method: string,
    taxYear: number,
    data: Omit<Prisma.PortfolioSnapshotUncheckedCreateInput, 'userId' | 'mint' | 'method' | 'taxYear'>,
  ): Promise<PortfolioSnapshot> {
    return this.prisma.portfolioSnapshot.upsert({
      where: {
        userId_mint_method_taxYear: { userId, mint, method, taxYear },
      },
      create: { userId, mint, method, taxYear, ...data },
      update: { ...data, isStale: false },
    });
  }

  async findByUser(
    userId: string,
    options?: { taxYear?: number; method?: string },
  ): Promise<PortfolioSnapshot[]> {
    return this.prisma.portfolioSnapshot.findMany({
      where: {
        userId,
        ...(options?.taxYear && { taxYear: options.taxYear }),
        ...(options?.method && { method: options.method }),
      },
      orderBy: { realizedGainLoss: 'desc' },
    });
  }

  async markStale(userId: string): Promise<{ count: number }> {
    return this.prisma.portfolioSnapshot.updateMany({
      where: { userId },
      data: { isStale: true },
    });
  }

  async deleteByUser(userId: string): Promise<{ count: number }> {
    return this.prisma.portfolioSnapshot.deleteMany({ where: { userId } });
  }
}
