import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { TransactionEnrichment, Prisma } from '@prisma/client';

@Injectable()
export class TransactionEnrichmentRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.TransactionEnrichmentCreateInput): Promise<TransactionEnrichment> {
    return this.prisma.transactionEnrichment.create({ data });
  }

  async createMany(data: Prisma.TransactionEnrichmentCreateManyInput[]): Promise<{ count: number }> {
    return this.prisma.transactionEnrichment.createMany({
      data,
      skipDuplicates: true,
    });
  }

  async findByTransactionId(transactionId: string): Promise<TransactionEnrichment | null> {
    return this.prisma.transactionEnrichment.findUnique({
      where: { transactionId },
    });
  }

  async findUnknown(options?: { take?: number; skip?: number }): Promise<TransactionEnrichment[]> {
    return this.prisma.transactionEnrichment.findMany({
      where: { isUnknown: true },
      take: options?.take ?? 100,
      skip: options?.skip ?? 0,
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateUserLabel(
    transactionId: string,
    label: string,
    notes?: string,
  ): Promise<TransactionEnrichment> {
    return this.prisma.transactionEnrichment.update({
      where: { transactionId },
      data: { userLabel: label, userNotes: notes },
    });
  }

  async updateAiClassification(
    transactionId: string,
    classification: string,
    confidence: number,
  ): Promise<TransactionEnrichment> {
    return this.prisma.transactionEnrichment.update({
      where: { transactionId },
      data: {
        aiClassification: classification,
        aiConfidence: confidence,
        isUnknown: false,
      },
    });
  }
}
