import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { WalletInteraction } from '@prisma/client';

@Injectable()
export class WalletInteractionRepository {
  constructor(private prisma: PrismaService) {}

  async upsert(
    walletId: string,
    counterpartyId: string,
    valueUsd?: number,
    interactionAt?: Date,
  ): Promise<WalletInteraction> {
    const now = interactionAt ?? new Date();
    return this.prisma.walletInteraction.upsert({
      where: {
        walletId_counterpartyId: { walletId, counterpartyId },
      },
      create: {
        wallet: { connect: { id: walletId } },
        counterparty: { connect: { id: counterpartyId } },
        interactionCount: 1,
        totalValueUsd: valueUsd,
        lastInteractionAt: now,
      },
      update: {
        interactionCount: { increment: 1 },
        totalValueUsd: valueUsd ? { increment: valueUsd } : undefined,
        lastInteractionAt: now,
      },
    });
  }

  async findByWalletId(walletId: string): Promise<WalletInteraction[]> {
    return this.prisma.walletInteraction.findMany({
      where: { walletId },
      include: { counterparty: true },
      orderBy: { interactionCount: 'desc' },
    });
  }

  async findTopByWalletId(walletId: string, limit: number = 10): Promise<WalletInteraction[]> {
    return this.prisma.walletInteraction.findMany({
      where: { walletId },
      include: { counterparty: true },
      orderBy: { interactionCount: 'desc' },
      take: limit,
    });
  }
}
