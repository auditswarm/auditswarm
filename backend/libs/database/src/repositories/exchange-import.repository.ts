import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { ExchangeImport, ExchangeTransaction, Prisma } from '@prisma/client';

@Injectable()
export class ExchangeImportRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.ExchangeImportUncheckedCreateInput): Promise<ExchangeImport> {
    return this.prisma.exchangeImport.create({ data });
  }

  async findByUserId(userId: string): Promise<ExchangeImport[]> {
    return this.prisma.exchangeImport.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<ExchangeImport | null> {
    return this.prisma.exchangeImport.findUnique({
      where: { id },
      include: { transactions: true },
    });
  }

  async updateStatus(
    id: string,
    status: string,
    counts?: { totalRecords?: number; matchedRecords?: number; unmatchedRecords?: number; errorMessage?: string },
  ): Promise<ExchangeImport> {
    return this.prisma.exchangeImport.update({
      where: { id },
      data: { status, ...counts },
    });
  }

  async createTransactions(
    data: Prisma.ExchangeTransactionCreateManyInput[],
  ): Promise<{ count: number }> {
    return this.prisma.exchangeTransaction.createMany({ data });
  }

  async findTransactionsByImportId(
    importId: string,
    options?: { take?: number; skip?: number },
  ): Promise<ExchangeTransaction[]> {
    return this.prisma.exchangeTransaction.findMany({
      where: { importId },
      orderBy: { timestamp: 'desc' },
      take: Number.isFinite(options?.take) ? options!.take : 100,
      skip: Number.isFinite(options?.skip) ? options!.skip : 0,
    });
  }

  async delete(id: string): Promise<ExchangeImport> {
    return this.prisma.exchangeImport.delete({ where: { id } });
  }

  async confirmMatches(importId: string): Promise<{ count: number }> {
    return this.prisma.exchangeTransaction.updateMany({
      where: { importId, matchedTransactionId: { not: null } },
      data: { isConfirmed: true },
    });
  }
}
