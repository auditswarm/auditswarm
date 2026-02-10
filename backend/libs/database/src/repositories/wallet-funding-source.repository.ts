import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { WalletFundingSource, Prisma } from '@prisma/client';

@Injectable()
export class WalletFundingSourceRepository {
  constructor(private prisma: PrismaService) {}

  async findByWalletId(walletId: string): Promise<WalletFundingSource | null> {
    return this.prisma.walletFundingSource.findUnique({ where: { walletId } });
  }

  async findByFunderAddress(funderAddress: string): Promise<WalletFundingSource[]> {
    return this.prisma.walletFundingSource.findMany({ where: { funderAddress } });
  }

  async create(data: Prisma.WalletFundingSourceUncheckedCreateInput): Promise<WalletFundingSource> {
    return this.prisma.walletFundingSource.create({ data });
  }
}
