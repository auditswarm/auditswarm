import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { CounterpartyWallet, Prisma } from '@prisma/client';

@Injectable()
export class CounterpartyWalletRepository {
  constructor(private prisma: PrismaService) {}

  async upsert(
    address: string,
    data: Partial<Prisma.CounterpartyWalletCreateInput>,
  ): Promise<CounterpartyWallet> {
    return this.prisma.counterpartyWallet.upsert({
      where: { address },
      create: { address, ...data } as Prisma.CounterpartyWalletCreateInput,
      update: {
        interactionCount: { increment: 1 },
        ...data,
      },
    });
  }

  async findByAddress(address: string): Promise<CounterpartyWallet | null> {
    return this.prisma.counterpartyWallet.findUnique({ where: { address } });
  }

  async findById(id: string): Promise<CounterpartyWallet | null> {
    return this.prisma.counterpartyWallet.findUnique({ where: { id } });
  }

  async findSuggestionsForUser(
    userId: string,
    minInteractions: number = 5,
  ): Promise<CounterpartyWallet[]> {
    // Find counterparties that interact with user's wallets but aren't claimed
    return this.prisma.counterpartyWallet.findMany({
      where: {
        ownerId: null,
        interactionCount: { gte: minInteractions },
        interactions: {
          some: {
            wallet: { userId },
          },
        },
      },
      orderBy: { interactionCount: 'desc' },
      take: 20,
    });
  }

  async claim(id: string, ownerId: string): Promise<CounterpartyWallet> {
    return this.prisma.counterpartyWallet.update({
      where: { id },
      data: {
        owner: { connect: { id: ownerId } },
        labelSource: 'USER',
      },
    });
  }

  async incrementInteraction(address: string): Promise<CounterpartyWallet> {
    return this.prisma.counterpartyWallet.update({
      where: { address },
      data: { interactionCount: { increment: 1 } },
    });
  }

  async findUnlabeled(walletId: string, limit: number = 20): Promise<CounterpartyWallet[]> {
    return this.prisma.counterpartyWallet.findMany({
      where: {
        label: null,
        isKnownProgram: false,
        interactions: {
          some: { walletId },
        },
      },
      orderBy: { interactionCount: 'desc' },
      take: limit,
    });
  }
}
