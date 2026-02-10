import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { WalletSyncState, Prisma } from '@prisma/client';

@Injectable()
export class WalletSyncStateRepository {
  constructor(private prisma: PrismaService) {}

  async upsert(
    walletId: string,
    data: Partial<Prisma.WalletSyncStateCreateInput>,
  ): Promise<WalletSyncState> {
    return this.prisma.walletSyncState.upsert({
      where: { walletId },
      create: {
        wallet: { connect: { id: walletId } },
        status: 'IDLE',
        ...data,
      } as Prisma.WalletSyncStateCreateInput,
      update: data,
    });
  }

  async findByWalletId(walletId: string): Promise<WalletSyncState | null> {
    return this.prisma.walletSyncState.findUnique({ where: { walletId } });
  }

  async updateProgress(
    walletId: string,
    lastSignature: string,
    progress: number,
    totalFound: number,
    totalIndexed: number,
  ): Promise<WalletSyncState> {
    return this.prisma.walletSyncState.update({
      where: { walletId },
      data: {
        lastSignature,
        progress,
        totalTransactionsFound: totalFound,
        totalTransactionsIndexed: totalIndexed,
      },
    });
  }

  async setStatus(
    walletId: string,
    status: string,
    extra?: Partial<Pick<WalletSyncState, 'lastSignature' | 'oldestSignature' | 'errorMessage'>>,
  ): Promise<WalletSyncState> {
    return this.prisma.walletSyncState.update({
      where: { walletId },
      data: { status, ...extra },
    });
  }

  async setError(
    walletId: string,
    errorMessage: string,
  ): Promise<WalletSyncState> {
    return this.prisma.walletSyncState.update({
      where: { walletId },
      data: {
        status: 'FAILED',
        errorMessage,
        errorCount: { increment: 1 },
      },
    });
  }
}
