import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  WalletRepository,
  TransactionRepository,
  WalletSyncStateRepository,
  CounterpartyWalletRepository,
  WalletFundingSourceRepository,
  UserAddressLabelRepository,
} from '@auditswarm/database';
import { QUEUES, JOB_NAMES } from '@auditswarm/queue';
import { isValidSolanaAddress } from '@auditswarm/common';
import type { Wallet, WalletSyncState, CounterpartyWallet, WalletFundingSource, UserAddressLabel } from '@prisma/client';

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
    private syncStateRepository: WalletSyncStateRepository,
    private counterpartyWalletRepository: CounterpartyWalletRepository,
    private fundingSourceRepository: WalletFundingSourceRepository,
    private addressLabelRepository: UserAddressLabelRepository,
    @InjectQueue(QUEUES.INDEXER) private indexerQueue: Queue,
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

    const wallet = await this.walletRepository.create({
      user: { connect: { id: userId } },
      address: dto.address,
      network: dto.network || 'solana',
      label: dto.label,
    });

    // Dispatch indexing jobs
    await this.indexerQueue.add(
      JOB_NAMES.INDEX_WALLET,
      {
        walletId: wallet.id,
        walletAddress: wallet.address,
      },
      {
        jobId: `index-wallet-${wallet.id}`,
        priority: 10,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    await this.indexerQueue.add(
      JOB_NAMES.REGISTER_WEBHOOK,
      {
        walletId: wallet.id,
        walletAddress: wallet.address,
        action: 'add',
      },
      {
        jobId: `register-webhook-${wallet.id}`,
        priority: 3,
      },
    );

    return wallet;
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
    const wallet = await this.findById(id, userId); // Verify ownership
    await this.walletRepository.deactivate(id);

    // Unregister webhook
    await this.indexerQueue.add(
      JOB_NAMES.REGISTER_WEBHOOK,
      {
        walletId: wallet.id,
        walletAddress: wallet.address,
        action: 'remove',
      },
      {
        jobId: `unregister-webhook-${wallet.id}`,
        priority: 3,
      },
    );
  }

  async getTransactions(
    id: string,
    userId: string,
    options?: { take?: number; skip?: number },
  ) {
    const wallet = await this.findById(id, userId);
    return this.transactionRepository.findByWalletId(wallet.id, {
      take: options?.take != null ? Number(options.take) : undefined,
      skip: options?.skip != null ? Number(options.skip) : undefined,
    });
  }

  async getTransactionCount(id: string, userId: string): Promise<number> {
    const wallet = await this.findById(id, userId);
    return this.transactionRepository.countByWalletId(wallet.id);
  }

  async getSyncStatus(id: string, userId: string): Promise<{
    status: string;
    progress: number;
    totalTransactionsFound: number;
    totalTransactionsIndexed: number;
    errorMessage?: string;
  }> {
    await this.findById(id, userId); // Verify ownership
    const syncState = await this.syncStateRepository.findByWalletId(id);

    if (!syncState) {
      return {
        status: 'IDLE',
        progress: 0,
        totalTransactionsFound: 0,
        totalTransactionsIndexed: 0,
      };
    }

    return {
      status: syncState.status,
      progress: syncState.progress,
      totalTransactionsFound: syncState.totalTransactionsFound,
      totalTransactionsIndexed: syncState.totalTransactionsIndexed,
      errorMessage: syncState.errorMessage ?? undefined,
    };
  }

  async forceSync(id: string, userId: string): Promise<{
    status: string;
    message: string;
  }> {
    const wallet = await this.findById(id, userId);

    // Check if already syncing
    const syncState = await this.syncStateRepository.findByWalletId(id);
    if (syncState?.status === 'SYNCING') {
      throw new ConflictException('Wallet is already syncing');
    }

    // Reset sync state
    await this.syncStateRepository.upsert(id, {
      status: 'IDLE',
      progress: 0,
      errorMessage: null,
      errorCount: 0,
    });

    // Dispatch indexer job (replace any existing job for this wallet)
    await this.indexerQueue.add(
      JOB_NAMES.INDEX_WALLET,
      {
        walletId: wallet.id,
        walletAddress: wallet.address,
      },
      {
        jobId: `index-wallet-${wallet.id}-${Date.now()}`,
        priority: 10,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return {
      status: 'SYNCING',
      message: `Sync dispatched for wallet ${wallet.address}`,
    };
  }

  async getCounterpartySuggestions(
    userId: string,
    minInteractions?: number,
  ): Promise<CounterpartyWallet[]> {
    return this.counterpartyWalletRepository.findSuggestionsForUser(
      userId,
      minInteractions != null ? Number(minInteractions) : 5,
    );
  }

  async claimCounterparty(
    userId: string,
    counterpartyId: string,
  ): Promise<{ counterparty: CounterpartyWallet; wallet: Wallet }> {
    const counterparty = await this.counterpartyWalletRepository.findById(counterpartyId);
    if (!counterparty) {
      throw new NotFoundException('Counterparty not found');
    }
    if (counterparty.ownerId) {
      throw new ConflictException('Counterparty already claimed');
    }

    // Claim the counterparty
    const claimed = await this.counterpartyWalletRepository.claim(counterpartyId, userId);

    // Create wallet
    const wallet = await this.walletRepository.create({
      user: { connect: { id: userId } },
      address: claimed.address,
      network: 'solana',
      label: claimed.label ?? `Claimed: ${claimed.address.slice(0, 8)}...`,
    });

    // Dispatch backfill + reclassify + webhook
    await this.indexerQueue.add(
      JOB_NAMES.INDEX_WALLET,
      { walletId: wallet.id, walletAddress: wallet.address },
      { jobId: `index-wallet-${wallet.id}`, priority: 10 },
    );

    await this.indexerQueue.add(
      JOB_NAMES.SYNC_WALLET,
      { walletId: wallet.id, walletAddress: wallet.address, reason: 'reclassify' },
      { jobId: `sync-wallet-${wallet.id}`, priority: 5 },
    );

    await this.indexerQueue.add(
      JOB_NAMES.REGISTER_WEBHOOK,
      { walletId: wallet.id, walletAddress: wallet.address, action: 'add' },
      { jobId: `register-webhook-${wallet.id}`, priority: 3 },
    );

    return { counterparty: claimed, wallet };
  }

  async getFundingSource(id: string, userId: string): Promise<WalletFundingSource | null> {
    await this.findById(id, userId); // Verify ownership
    return this.fundingSourceRepository.findByWalletId(id);
  }

  async getDiscoveries(userId: string): Promise<CounterpartyWallet[]> {
    return this.counterpartyWalletRepository.findSuggestionsForUser(userId, 3);
  }

  async setAddressLabel(
    userId: string,
    address: string,
    label: string,
    entityType?: string,
    notes?: string,
  ): Promise<UserAddressLabel> {
    return this.addressLabelRepository.upsert(userId, address, { label, entityType, notes });
  }

  async getAddressLabels(userId: string): Promise<UserAddressLabel[]> {
    return this.addressLabelRepository.findByUserId(userId);
  }

  async deleteAddressLabel(id: string, userId: string): Promise<void> {
    const label = await this.addressLabelRepository.findById(id);
    if (!label || label.userId !== userId) {
      throw new NotFoundException('Address label not found');
    }
    await this.addressLabelRepository.delete(id);
  }
}
