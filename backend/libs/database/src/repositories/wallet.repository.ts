import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Wallet, Prisma } from '@prisma/client';

@Injectable()
export class WalletRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.WalletCreateInput): Promise<Wallet> {
    return this.prisma.wallet.create({ data });
  }

  async findById(id: string): Promise<Wallet | null> {
    return this.prisma.wallet.findUnique({ where: { id } });
  }

  async findByAddress(address: string): Promise<Wallet | null> {
    return this.prisma.wallet.findFirst({ where: { address } });
  }

  async findByUserAndAddress(userId: string, address: string): Promise<Wallet | null> {
    return this.prisma.wallet.findUnique({
      where: { userId_address: { userId, address } },
    });
  }

  async findByUserId(userId: string): Promise<Wallet[]> {
    return this.prisma.wallet.findMany({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllActive(): Promise<Wallet[]> {
    return this.prisma.wallet.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(id: string, data: Prisma.WalletUpdateInput): Promise<Wallet> {
    return this.prisma.wallet.update({ where: { id }, data });
  }

  async updateTransactionStats(
    id: string,
    lastTransactionAt: Date,
    totalCount: number,
  ): Promise<Wallet> {
    return this.prisma.wallet.update({
      where: { id },
      data: {
        lastTransactionAt,
        transactionCount: totalCount,
      },
    });
  }

  async deactivate(id: string): Promise<Wallet> {
    return this.prisma.wallet.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async delete(id: string): Promise<Wallet> {
    return this.prisma.wallet.delete({ where: { id } });
  }

  async findWithTransactions(id: string, options?: { take?: number; skip?: number }) {
    return this.prisma.wallet.findUnique({
      where: { id },
      include: {
        transactions: {
          take: Number.isFinite(options?.take) ? options!.take : 100,
          skip: Number.isFinite(options?.skip) ? options!.skip : 0,
          orderBy: { timestamp: 'desc' },
        },
      },
    });
  }
}
