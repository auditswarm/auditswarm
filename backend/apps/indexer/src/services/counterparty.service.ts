import { Injectable, Logger } from '@nestjs/common';
import {
  CounterpartyWalletRepository,
  WalletInteractionRepository,
  WalletRepository,
  TransactionRepository,
  KnownAddressRepository,
} from '@auditswarm/database';
import { getKnownProgram } from '../constants/known-programs';
import { getKnownExchange } from '../constants/known-exchanges';
import type { CounterpartyWallet } from '@prisma/client';

@Injectable()
export class CounterpartyService {
  private readonly logger = new Logger(CounterpartyService.name);

  constructor(
    private counterpartyRepo: CounterpartyWalletRepository,
    private interactionRepo: WalletInteractionRepository,
    private walletRepo: WalletRepository,
    private transactionRepo: TransactionRepository,
    private knownAddressRepo: KnownAddressRepository,
  ) {}

  async processTransaction(
    walletId: string,
    addresses: string[],
    timestamp: Date,
    valueUsd?: number,
  ): Promise<void> {
    for (const address of addresses) {
      try {
        // Auto-label if known
        const exchange = getKnownExchange(address);
        const program = getKnownProgram(address);

        let label: string | undefined;
        let labelSource: string | undefined;
        let entityType: string | undefined;
        let isKnownProgram = false;

        if (exchange) {
          label = exchange.label;
          labelSource = 'AUTO_EXCHANGE';
          entityType = 'EXCHANGE';
        } else if (!exchange) {
          // Fallback: check known addresses DB
          const knownAddr = await this.knownAddressRepo.findByAddress(address);
          if (knownAddr) {
            label = knownAddr.label;
            labelSource = 'AUTO_EXCHANGE';
            entityType = knownAddr.entityType;
          }
        }

        if (!label && program) {
          label = program.name;
          labelSource = 'AUTO_PROGRAM';
          entityType = program.entityType;
          isKnownProgram = true;
        }

        // Upsert counterparty wallet
        const counterparty = await this.counterpartyRepo.upsert(address, {
          ...(label && { label }),
          ...(labelSource && { labelSource }),
          ...(entityType && { entityType }),
          isKnownProgram,
        });

        // Upsert interaction
        const perAddressValue = valueUsd && addresses.length > 0
          ? valueUsd / addresses.length
          : undefined;

        await this.interactionRepo.upsert(
          walletId,
          counterparty.id,
          perAddressValue,
          timestamp,
        );
      } catch (error) {
        this.logger.warn(`Failed to process counterparty ${address}: ${error}`);
      }
    }
  }

  async getSuggestions(
    userId: string,
    minInteractions: number = 5,
  ): Promise<CounterpartyWallet[]> {
    return this.counterpartyRepo.findSuggestionsForUser(userId, minInteractions);
  }

  async claimCounterparty(
    userId: string,
    counterpartyId: string,
  ): Promise<{ counterparty: CounterpartyWallet; walletId: string }> {
    const counterparty = await this.counterpartyRepo.claim(counterpartyId, userId);

    // Create a new Wallet record for the claimed counterparty
    const wallet = await this.walletRepo.create({
      user: { connect: { id: userId } },
      address: counterparty.address,
      network: 'solana',
      label: counterparty.label ?? `Claimed: ${counterparty.address.slice(0, 8)}...`,
    });

    this.logger.log(
      `User ${userId} claimed counterparty ${counterpartyId} (${counterparty.address}), created wallet ${wallet.id}`,
    );

    return { counterparty, walletId: wallet.id };
  }

  async reclassifyForNewWallet(walletId: string, walletAddress: string): Promise<number> {
    // Find existing transactions where this address appears as counterparty
    // and reclassify TRANSFER_IN/OUT -> INTERNAL_TRANSFER
    let reclassified = 0;

    // Get all wallets for this user (to find related transactions)
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) return 0;

    const userWallets = await this.walletRepo.findByUserId(wallet.userId);
    const userAddresses = new Set(userWallets.map(w => w.address));

    for (const userWallet of userWallets) {
      if (userWallet.id === walletId) continue;

      const transactions = await this.transactionRepo.findByWalletId(userWallet.id, {
        take: 10000,
      });

      for (const tx of transactions) {
        if (tx.type !== 'TRANSFER_IN' && tx.type !== 'TRANSFER_OUT') continue;

        // Check if the transfer involves the new wallet address
        const transfers = Array.isArray(tx.transfers) ? tx.transfers as any[] : [];
        const involvesNewWallet = transfers.some(
          (t: any) =>
            t.from === walletAddress ||
            t.to === walletAddress ||
            t.fromUserAccount === walletAddress ||
            t.toUserAccount === walletAddress,
        );

        if (involvesNewWallet) {
          await this.transactionRepo.update(tx.id, { type: 'INTERNAL_TRANSFER' });
          reclassified++;
        }
      }
    }

    this.logger.log(`Reclassified ${reclassified} transactions for new wallet ${walletAddress}`);
    return reclassified;
  }
}
