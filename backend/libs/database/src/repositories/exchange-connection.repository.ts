import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ExchangeConnection, Prisma } from '@prisma/client';

@Injectable()
export class ExchangeConnectionRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.ExchangeConnectionUncheckedCreateInput): Promise<ExchangeConnection> {
    return this.prisma.exchangeConnection.create({ data });
  }

  async findById(id: string): Promise<ExchangeConnection | null> {
    return this.prisma.exchangeConnection.findUnique({ where: { id } });
  }

  async findByUserId(userId: string): Promise<ExchangeConnection[]> {
    return this.prisma.exchangeConnection.findMany({
      where: { userId, status: { not: 'REVOKED' } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveByUserAndExchange(
    userId: string,
    exchangeName: string,
    subAccountLabel?: string,
  ): Promise<ExchangeConnection | null> {
    return this.prisma.exchangeConnection.findFirst({
      where: {
        userId,
        exchangeName,
        subAccountLabel: subAccountLabel ?? null,
        status: 'ACTIVE',
      },
    });
  }

  async updateStatus(
    id: string,
    status: string,
    extra?: { lastSyncAt?: Date; lastError?: string; syncCursor?: any; permissions?: string[] },
  ): Promise<ExchangeConnection> {
    return this.prisma.exchangeConnection.update({
      where: { id },
      data: { status, ...extra },
    });
  }

  async updateSyncState(
    id: string,
    data: { lastSyncAt?: Date; lastError?: string | null; syncCursor?: any },
  ): Promise<ExchangeConnection> {
    return this.prisma.exchangeConnection.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<ExchangeConnection> {
    return this.prisma.exchangeConnection.update({
      where: { id },
      data: { status: 'REVOKED' },
    });
  }

  async hardDelete(id: string): Promise<ExchangeConnection> {
    return this.prisma.exchangeConnection.delete({ where: { id } });
  }

  async countTransactions(connectionId: string): Promise<number> {
    return this.prisma.transaction.count({
      where: { exchangeConnectionId: connectionId },
    });
  }
}
