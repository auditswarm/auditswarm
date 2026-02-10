import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Audit, AuditResult, Prisma } from '@prisma/client';

@Injectable()
export class AuditRepository {
  constructor(private prisma: PrismaService) {}

  async create(
    data: Prisma.AuditCreateInput,
    walletIds: string[],
  ): Promise<Audit> {
    return this.prisma.audit.create({
      data: {
        ...data,
        wallets: {
          create: walletIds.map(walletId => ({ walletId })),
        },
      },
      include: { wallets: true },
    });
  }

  async findById(id: string): Promise<Audit | null> {
    return this.prisma.audit.findUnique({
      where: { id },
      include: {
        wallets: { include: { wallet: true } },
        result: true,
      },
    });
  }

  async findByUserId(
    userId: string,
    options?: { take?: number; skip?: number; status?: string },
  ): Promise<Audit[]> {
    return this.prisma.audit.findMany({
      where: {
        userId,
        status: options?.status,
      },
      take: options?.take ?? 20,
      skip: options?.skip ?? 0,
      orderBy: { createdAt: 'desc' },
      include: { wallets: { include: { wallet: true } } },
    });
  }

  async findPending(): Promise<Audit[]> {
    return this.prisma.audit.findMany({
      where: { status: { in: ['PENDING', 'QUEUED'] } },
      orderBy: { createdAt: 'asc' },
      include: { wallets: { include: { wallet: true } } },
    });
  }

  async updateStatus(
    id: string,
    status: string,
    progress?: number,
    message?: string,
  ): Promise<Audit> {
    const data: Prisma.AuditUpdateInput = {
      status,
      statusMessage: message,
      updatedAt: new Date(),
    };

    if (progress !== undefined) {
      data.progress = progress;
    }

    if (status === 'PROCESSING' && !data.startedAt) {
      data.startedAt = new Date();
    }

    if (status === 'COMPLETED' || status === 'FAILED') {
      data.completedAt = new Date();
    }

    return this.prisma.audit.update({ where: { id }, data });
  }

  async setResult(id: string, resultId: string): Promise<Audit> {
    return this.prisma.audit.update({
      where: { id },
      data: { resultId },
    });
  }

  async setError(id: string, errorMessage: string, errorDetails?: object): Promise<Audit> {
    return this.prisma.audit.update({
      where: { id },
      data: {
        status: 'FAILED',
        errorMessage,
        errorDetails: errorDetails as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
  }

  async createResult(data: Prisma.AuditResultCreateInput): Promise<AuditResult> {
    return this.prisma.auditResult.create({ data });
  }

  async findResultById(id: string): Promise<AuditResult | null> {
    return this.prisma.auditResult.findUnique({ where: { id } });
  }

  async findResultByAuditId(auditId: string): Promise<AuditResult | null> {
    return this.prisma.auditResult.findUnique({ where: { auditId } });
  }

  async countByUserId(userId: string): Promise<number> {
    return this.prisma.audit.count({ where: { userId } });
  }

  async countByStatus(status: string): Promise<number> {
    return this.prisma.audit.count({ where: { status } });
  }
}
