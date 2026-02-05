import { Injectable, NotFoundException } from '@nestjs/common';
import { TransactionRepository, WalletRepository, TransactionFilter } from '@auditswarm/database';
import type { Transaction } from '@prisma/client';

export interface TransactionQueryDto {
  walletIds?: string[];
  type?: string;
  types?: string[];
  startDate?: Date;
  endDate?: Date;
  minValue?: number;
  maxValue?: number;
  take?: number;
  skip?: number;
}

@Injectable()
export class TransactionsService {
  constructor(
    private transactionRepository: TransactionRepository,
    private walletRepository: WalletRepository,
  ) {}

  async findByFilter(userId: string, query: TransactionQueryDto): Promise<Transaction[]> {
    // Verify user owns the wallets
    if (query.walletIds?.length) {
      for (const walletId of query.walletIds) {
        const wallet = await this.walletRepository.findById(walletId);
        if (!wallet || wallet.userId !== userId) {
          throw new NotFoundException(`Wallet not found: ${walletId}`);
        }
      }
    } else {
      // Get all user's wallets
      const wallets = await this.walletRepository.findByUserId(userId);
      query.walletIds = wallets.map(w => w.id);
    }

    const filter: TransactionFilter = {
      walletIds: query.walletIds,
      type: query.type,
      types: query.types,
      startDate: query.startDate,
      endDate: query.endDate,
      minValue: query.minValue,
      maxValue: query.maxValue,
    };

    return this.transactionRepository.findByFilter(filter, {
      take: query.take,
      skip: query.skip,
    });
  }

  async findById(id: string, userId: string): Promise<Transaction> {
    const transaction = await this.transactionRepository.findById(id);
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    // Verify ownership
    const wallet = await this.walletRepository.findById(transaction.walletId);
    if (!wallet || wallet.userId !== userId) {
      throw new NotFoundException('Transaction not found');
    }

    return transaction;
  }

  async findBySignature(signature: string, userId: string): Promise<Transaction> {
    const transaction = await this.transactionRepository.findBySignature(signature);
    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    const wallet = await this.walletRepository.findById(transaction.walletId);
    if (!wallet || wallet.userId !== userId) {
      throw new NotFoundException('Transaction not found');
    }

    return transaction;
  }

  async getStats(userId: string, filter?: TransactionFilter) {
    const wallets = await this.walletRepository.findByUserId(userId);
    const walletIds = wallets.map(w => w.id);

    const count = await this.transactionRepository.countByFilter({
      ...filter,
      walletIds,
    });

    const gainLoss = await this.transactionRepository.getGainLossSum({
      ...filter,
      walletIds,
    });

    return {
      totalTransactions: count,
      totalGains: gainLoss.gains,
      totalLosses: gainLoss.losses,
      netGainLoss: gainLoss.gains - gainLoss.losses,
    };
  }
}
