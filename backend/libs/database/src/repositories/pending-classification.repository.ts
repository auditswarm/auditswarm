import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { PendingClassification, Prisma } from '@prisma/client';

@Injectable()
export class PendingClassificationRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.PendingClassificationUncheckedCreateInput): Promise<PendingClassification> {
    return this.prisma.pendingClassification.create({ data });
  }

  async createMany(data: Prisma.PendingClassificationCreateManyInput[]): Promise<{ count: number }> {
    return this.prisma.pendingClassification.createMany({ data, skipDuplicates: true });
  }

  async findPendingByUserId(
    userId: string,
    options?: { take?: number; skip?: number },
  ): Promise<PendingClassification[]> {
    return this.prisma.pendingClassification.findMany({
      where: { userId, status: 'PENDING' },
      orderBy: [{ estimatedValueUsd: 'desc' }, { priority: 'desc' }],
      take: Number.isFinite(options?.take) ? options!.take : 50,
      skip: Number.isFinite(options?.skip) ? options!.skip : 0,
      include: { transaction: true },
    });
  }

  async countPendingByUserId(userId: string): Promise<number> {
    return this.prisma.pendingClassification.count({
      where: { userId, status: 'PENDING' },
    });
  }

  async resolve(
    id: string,
    resolvedCategory: string,
    notes?: string,
  ): Promise<PendingClassification> {
    return this.prisma.pendingClassification.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedCategory,
        notes,
        resolvedAt: new Date(),
      },
    });
  }

  async batchResolve(
    ids: string[],
    resolvedCategory: string,
  ): Promise<{ count: number }> {
    return this.prisma.pendingClassification.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'RESOLVED',
        resolvedCategory,
        resolvedAt: new Date(),
      },
    });
  }

  async autoResolve(
    id: string,
    resolvedCategory: string,
    reason: string,
  ): Promise<PendingClassification> {
    return this.prisma.pendingClassification.update({
      where: { id },
      data: {
        status: 'AUTO_RESOLVED',
        resolvedCategory,
        autoResolveReason: reason,
        resolvedAt: new Date(),
      },
    });
  }

  async getStats(userId: string): Promise<{
    pending: number;
    resolved: number;
    autoResolved: number;
  }> {
    const [pending, resolved, autoResolved] = await Promise.all([
      this.prisma.pendingClassification.count({ where: { userId, status: 'PENDING' } }),
      this.prisma.pendingClassification.count({ where: { userId, status: 'RESOLVED' } }),
      this.prisma.pendingClassification.count({ where: { userId, status: 'AUTO_RESOLVED' } }),
    ]);
    return { pending, resolved, autoResolved };
  }

  async findById(id: string): Promise<PendingClassification | null> {
    return this.prisma.pendingClassification.findUnique({
      where: { id },
      include: { transaction: true },
    });
  }
}
