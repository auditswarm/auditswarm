import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Transaction, Prisma } from '@prisma/client';

export interface TransactionFilter {
  walletId?: string;
  walletIds?: string[];
  type?: string;
  types?: string[];
  excludeTypes?: string[];
  startDate?: Date;
  endDate?: Date;
  minValue?: number;
  maxValue?: number;
  source?: string;                    // ONCHAIN, EXCHANGE, MANUAL
  exchangeConnectionIds?: string[];   // filter by exchange connection
}

@Injectable()
export class TransactionRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.TransactionCreateInput): Promise<Transaction> {
    return this.prisma.transaction.create({ data });
  }

  async createMany(data: Prisma.TransactionCreateManyInput[]): Promise<{ count: number }> {
    return this.prisma.transaction.createMany({
      data,
      skipDuplicates: true,
    });
  }

  async findById(id: string): Promise<Transaction | null> {
    return this.prisma.transaction.findUnique({
      where: { id },
      include: { enrichment: true },
    });
  }

  async findBySignature(signature: string): Promise<Transaction | null> {
    return this.prisma.transaction.findUnique({
      where: { signature },
      include: { enrichment: true },
    });
  }

  async findByWalletId(
    walletId: string,
    options?: { take?: number; skip?: number; orderBy?: 'asc' | 'desc' },
  ): Promise<Transaction[]> {
    return this.prisma.transaction.findMany({
      where: { walletId },
      take: options?.take ?? 100,
      skip: options?.skip ?? 0,
      orderBy: { timestamp: options?.orderBy ?? 'desc' },
    });
  }

  async findByFilter(
    filter: TransactionFilter,
    options?: { take?: number; skip?: number; sortBy?: string; sortOrder?: 'asc' | 'desc' },
  ): Promise<Transaction[]> {
    const where: Prisma.TransactionWhereInput = {};

    // Build OR conditions for wallet + exchange sources
    const orConditions: Prisma.TransactionWhereInput[] = [];

    if (filter.walletId) {
      orConditions.push({ walletId: filter.walletId });
    }
    if (filter.walletIds?.length) {
      orConditions.push({ walletId: { in: filter.walletIds } });
    }
    if (filter.exchangeConnectionIds?.length) {
      orConditions.push({ exchangeConnectionId: { in: filter.exchangeConnectionIds } });
    }

    if (orConditions.length > 1) {
      where.OR = orConditions;
    } else if (orConditions.length === 1) {
      Object.assign(where, orConditions[0]);
    }

    // Source filter
    if (filter.source) {
      where.source = filter.source;
    }

    if (filter.type) {
      where.type = filter.type;
    }
    if (filter.types?.length) {
      where.type = { in: filter.types };
    }
    if (filter.excludeTypes?.length) {
      if (typeof where.type === 'string') {
        where.type = { equals: where.type, notIn: filter.excludeTypes };
      } else if (where.type && typeof where.type === 'object') {
        (where.type as Record<string, unknown>).notIn = filter.excludeTypes;
      } else {
        where.type = { notIn: filter.excludeTypes };
      }
    }
    if (filter.startDate || filter.endDate) {
      where.timestamp = {};
      if (filter.startDate) {
        where.timestamp.gte = filter.startDate;
      }
      if (filter.endDate) {
        where.timestamp.lte = filter.endDate;
      }
    }
    if (filter.minValue !== undefined || filter.maxValue !== undefined) {
      where.totalValueUsd = {};
      if (filter.minValue !== undefined) {
        where.totalValueUsd.gte = filter.minValue;
      }
      if (filter.maxValue !== undefined) {
        where.totalValueUsd.lte = filter.maxValue;
      }
    }

    const validSortFields = ['timestamp', 'totalValueUsd', 'type', 'fee', 'createdAt'];
    const sortBy = validSortFields.includes(options?.sortBy ?? '') ? options!.sortBy! : 'timestamp';
    const sortOrder = options?.sortOrder ?? 'desc';

    return this.prisma.transaction.findMany({
      where,
      include: { enrichment: true },
      take: options?.take ?? 1000,
      skip: options?.skip ?? 0,
      orderBy: { [sortBy]: sortOrder },
    });
  }

  async findExistingSignatures(signatures: string[]): Promise<string[]> {
    const results = await this.prisma.transaction.findMany({
      where: { signature: { in: signatures } },
      select: { signature: true },
    });
    return results.filter(r => r.signature != null).map(r => r.signature!);
  }

  async update(id: string, data: Prisma.TransactionUpdateInput): Promise<Transaction> {
    return this.prisma.transaction.update({ where: { id }, data });
  }

  async updateCostBasis(
    id: string,
    costBasis: { method: string; amount: number; gainLoss: number; type: string },
  ): Promise<Transaction> {
    return this.prisma.transaction.update({
      where: { id },
      data: {
        costBasisMethod: costBasis.method,
        costBasisUsd: costBasis.amount,
        gainLossUsd: costBasis.gainLoss,
        gainLossType: costBasis.type,
      },
    });
  }

  async countByWalletId(walletId: string): Promise<number> {
    return this.prisma.transaction.count({ where: { walletId } });
  }

  async countByFilter(filter: TransactionFilter): Promise<number> {
    const where: Prisma.TransactionWhereInput = {};

    if (filter.walletIds?.length) {
      where.walletId = { in: filter.walletIds };
    }
    if (filter.startDate || filter.endDate) {
      where.timestamp = {};
      if (filter.startDate) where.timestamp.gte = filter.startDate;
      if (filter.endDate) where.timestamp.lte = filter.endDate;
    }

    return this.prisma.transaction.count({ where });
  }

  async getValueSum(filter: TransactionFilter): Promise<number> {
    const result = await this.prisma.transaction.aggregate({
      where: {
        walletId: filter.walletIds?.length ? { in: filter.walletIds } : filter.walletId,
        timestamp: {
          gte: filter.startDate,
          lte: filter.endDate,
        },
      },
      _sum: { totalValueUsd: true },
    });

    return Number(result._sum.totalValueUsd ?? 0);
  }

  async getGainLossSum(filter: TransactionFilter): Promise<{ gains: number; losses: number }> {
    const transactions = await this.findByFilter(filter);

    let gains = 0;
    let losses = 0;

    for (const tx of transactions) {
      const gl = Number(tx.gainLossUsd ?? 0);
      if (gl > 0) gains += gl;
      else losses += Math.abs(gl);
    }

    return { gains, losses };
  }
}
