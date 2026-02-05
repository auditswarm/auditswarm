import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { WalletRepository, TransactionRepository } from '@auditswarm/database';
import { isValidSolanaAddress } from '@auditswarm/common';
import type { Wallet } from '@prisma/client';

export interface CreateWalletDto {
  address: string;
  label?: string;
  network?: string;
}

export interface UpdateWalletDto {
  label?: string;
  isActive?: boolean;
}

@Injectable()
export class WalletsService {
  constructor(
    private walletRepository: WalletRepository,
    private transactionRepository: TransactionRepository,
  ) {}

  async create(userId: string, dto: CreateWalletDto): Promise<Wallet> {
    // Validate address format
    if (!isValidSolanaAddress(dto.address)) {
      throw new ConflictException('Invalid Solana address format');
    }

    // Check if wallet already exists for user
    const existing = await this.walletRepository.findByUserAndAddress(userId, dto.address);
    if (existing) {
      throw new ConflictException('Wallet already connected');
    }

    return this.walletRepository.create({
      user: { connect: { id: userId } },
      address: dto.address,
      network: dto.network || 'solana',
      label: dto.label,
    });
  }

  async findByUserId(userId: string): Promise<Wallet[]> {
    return this.walletRepository.findByUserId(userId);
  }

  async findById(id: string, userId: string): Promise<Wallet> {
    const wallet = await this.walletRepository.findById(id);
    if (!wallet || wallet.userId !== userId) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet;
  }

  async update(id: string, userId: string, dto: UpdateWalletDto): Promise<Wallet> {
    await this.findById(id, userId); // Verify ownership
    return this.walletRepository.update(id, dto);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.findById(id, userId); // Verify ownership
    await this.walletRepository.deactivate(id);
  }

  async getTransactions(
    id: string,
    userId: string,
    options?: { take?: number; skip?: number },
  ) {
    const wallet = await this.findById(id, userId);
    return this.transactionRepository.findByWalletId(wallet.id, options);
  }

  async getTransactionCount(id: string, userId: string): Promise<number> {
    const wallet = await this.findById(id, userId);
    return this.transactionRepository.countByWalletId(wallet.id);
  }
}
