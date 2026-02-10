import { Injectable, Logger } from '@nestjs/common';
import {
  TransactionRepository,
  WalletRepository,
  PendingClassificationRepository,
  KnownAddressRepository,
  CounterpartyWalletRepository,
} from '@auditswarm/database';
import { TAX_CATEGORIES, type TaxCategory } from '@auditswarm/common';

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  private static readonly DUST_THRESHOLD_USD = 0.5;

  private static readonly BRIDGE_PROGRAMS = new Set([
    'worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth',  // Wormhole
    'Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o',   // Wormhole Token Bridge
    'src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4',   // deBridge
    'ABrn41WMEfGSdMSLDaRoyJbuHYJzSBwgxZyRmvhpuBTB', // Allbridge
  ]);

  private static readonly STAKING_PROGRAMS = new Set([
    'Stake11111111111111111111111111111111111111',
    'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy',  // Marinade
    'CgntPoLka5pD5fesJYhGmUCF8KU1QS1ZmZiuAuMZr2az', // Jito
  ]);

  constructor(
    private transactionRepo: TransactionRepository,
    private walletRepo: WalletRepository,
    private pendingClassificationRepo: PendingClassificationRepository,
    private knownAddressRepo: KnownAddressRepository,
    private counterpartyRepo: CounterpartyWalletRepository,
  ) {}

  async classifyWalletTransactions(
    walletId: string,
    walletAddress: string,
    userId: string,
  ): Promise<{ classified: number; pending: number; autoResolved: number }> {
    this.logger.log(`Classifying transactions for wallet ${walletId}`);

    // Get all user wallet addresses for internal transfer detection
    const userWallets = await this.walletRepo.findByUserId(userId);
    const userAddresses = new Set(userWallets.map(w => w.address.toLowerCase()));

    // Get all transactions for this wallet
    const transactions = await this.transactionRepo.findByWalletId(walletId, {
      take: 50000,
      orderBy: 'desc',
    });

    let classified = 0;
    let pending = 0;
    let autoResolved = 0;
    const pendingItems: any[] = [];

    for (const tx of transactions) {
      // Skip already classified
      if (tx.classificationStatus) continue;

      const result = await this.classifyTransaction(tx, walletAddress, userAddresses);

      if (result.status === 'CLASSIFIED' || result.status === 'AUTO_RESOLVED') {
        await this.transactionRepo.update(tx.id, {
          category: result.category,
          classificationStatus: result.status,
        });

        if (result.status === 'AUTO_RESOLVED') autoResolved++;
        else classified++;
      } else {
        // Create pending classification
        pendingItems.push({
          userId,
          transactionId: tx.id,
          type: 'TRANSACTION',
          status: 'PENDING',
          priority: this.calculatePriority(tx),
          suggestedCategory: result.suggestedCategory,
          estimatedValueUsd: tx.totalValueUsd,
        });
        pending++;
      }
    }

    // Batch create pending classifications
    if (pendingItems.length > 0) {
      await this.pendingClassificationRepo.createMany(pendingItems);
    }

    // Mark pending transactions
    if (pending > 0) {
      // Already handled inline above — transactions with pending items have classificationStatus set via update
      for (const item of pendingItems) {
        await this.transactionRepo.update(item.transactionId, {
          classificationStatus: 'PENDING',
        });
      }
    }

    this.logger.log(
      `Classification complete for wallet ${walletId}: ${classified} classified, ${autoResolved} auto-resolved, ${pending} pending`,
    );

    return { classified, pending, autoResolved };
  }

  private async classifyTransaction(
    tx: any,
    walletAddress: string,
    userAddresses: Set<string>,
  ): Promise<{
    status: 'CLASSIFIED' | 'AUTO_RESOLVED' | 'PENDING';
    category?: TaxCategory;
    suggestedCategory?: TaxCategory;
  }> {
    const totalValue = tx.totalValueUsd ? Number(tx.totalValueUsd) : 0;
    const enrichment = tx.enrichment;
    const transfers = (tx.transfers as any[] | null) ?? [];

    // 1. Dust check — auto-resolve
    if (totalValue < ClassificationService.DUST_THRESHOLD_USD && totalValue > 0) {
      return { status: 'AUTO_RESOLVED', category: TAX_CATEGORIES.DUST };
    }

    // 2. Internal transfer — auto-resolve
    if (this.isInternalTransfer(transfers, walletAddress, userAddresses)) {
      return { status: 'AUTO_RESOLVED', category: TAX_CATEGORIES.TRANSFER_INTERNAL };
    }

    // 3. Bridge transaction — auto-resolve
    if (this.isBridgeTransaction(enrichment)) {
      const direction = tx.type === 'TRANSFER_OUT' ? TAX_CATEGORIES.BRIDGE_OUT : TAX_CATEGORIES.BRIDGE_IN;
      return { status: 'AUTO_RESOLVED', category: direction };
    }

    // 4. Staking reward — auto-resolve
    if (this.isStakingReward(tx, enrichment)) {
      return { status: 'AUTO_RESOLVED', category: TAX_CATEGORIES.INCOME_STAKING_REWARD };
    }

    // 5. Swap — auto-classify
    if (tx.type === 'SWAP') {
      return { status: 'CLASSIFIED', category: TAX_CATEGORIES.DISPOSAL_SWAP };
    }

    // 6. Transfer to known exchange — pending (needs offramp confirmation)
    if (tx.type === 'TRANSFER_OUT') {
      const destAddress = this.getDestinationAddress(transfers, walletAddress);
      if (destAddress) {
        const knownAddr = await this.knownAddressRepo.findByAddress(destAddress);
        if (knownAddr?.entityType === 'EXCHANGE') {
          return { status: 'PENDING', suggestedCategory: TAX_CATEGORIES.TRANSFER_TO_EXCHANGE };
        }
      }
    }

    // 7. Transfer from known exchange — auto-classify
    if (tx.type === 'TRANSFER_IN') {
      const sourceAddress = this.getSourceAddress(transfers, walletAddress);
      if (sourceAddress) {
        const knownAddr = await this.knownAddressRepo.findByAddress(sourceAddress);
        if (knownAddr?.entityType === 'EXCHANGE') {
          return { status: 'CLASSIFIED', category: TAX_CATEGORIES.TRANSFER_FROM_EXCHANGE };
        }
      }

      // Possible airdrop (no value)
      if (totalValue === 0) {
        return { status: 'PENDING', suggestedCategory: TAX_CATEGORIES.INCOME_AIRDROP };
      }
    }

    // 8. LP operations — auto-classify from enrichment
    if (tx.type === 'LP_DEPOSIT') {
      return { status: 'CLASSIFIED', category: TAX_CATEGORIES.DEFI_LP_ADD };
    }
    if (tx.type === 'LP_WITHDRAW') {
      return { status: 'CLASSIFIED', category: TAX_CATEGORIES.DEFI_LP_REMOVE };
    }

    // 9. Borrow/repay — auto-classify
    if (tx.type === 'LOAN_BORROW') {
      return { status: 'CLASSIFIED', category: TAX_CATEGORIES.DEFI_BORROW };
    }
    if (tx.type === 'LOAN_REPAY') {
      return { status: 'CLASSIFIED', category: TAX_CATEGORIES.DEFI_REPAY };
    }

    // 10. Burn — auto-classify as dust/non-taxable
    if (tx.type === 'BURN') {
      return { status: 'AUTO_RESOLVED', category: TAX_CATEGORIES.DUST };
    }

    // 11. Program interaction (deploys, upgrades, infra) — auto-resolve as non-taxable fee
    if (tx.type === 'PROGRAM_INTERACTION') {
      return { status: 'AUTO_RESOLVED', category: TAX_CATEGORIES.DUST };
    }

    // Everything else with value > threshold → pending
    if (totalValue >= ClassificationService.DUST_THRESHOLD_USD) {
      return { status: 'PENDING', suggestedCategory: TAX_CATEGORIES.PENDING_REVIEW };
    }

    // Zero-value unknowns → auto-resolve as dust
    return { status: 'AUTO_RESOLVED', category: TAX_CATEGORIES.DUST };
  }

  private isInternalTransfer(
    transfers: any[],
    walletAddress: string,
    userAddresses: Set<string>,
  ): boolean {
    const walletAddr = walletAddress.toLowerCase();
    for (const t of transfers) {
      const from = (t.from ?? '').toLowerCase();
      const to = (t.to ?? '').toLowerCase();
      const fromUser = (t.fromUserAccount ?? '').toLowerCase();
      const toUser = (t.toUserAccount ?? '').toLowerCase();

      // If the counterparty address belongs to user's other wallets → internal
      if (from !== walletAddr && userAddresses.has(from)) return true;
      if (to !== walletAddr && userAddresses.has(to)) return true;
      if (fromUser !== walletAddr && userAddresses.has(fromUser)) return true;
      if (toUser !== walletAddr && userAddresses.has(toUser)) return true;
    }
    return false;
  }

  private isBridgeTransaction(enrichment: any): boolean {
    if (!enrichment) return false;
    const programId = enrichment.protocolProgramId;
    return programId ? ClassificationService.BRIDGE_PROGRAMS.has(programId) : false;
  }

  private isStakingReward(tx: any, enrichment: any): boolean {
    if (tx.type !== 'TRANSFER_IN') return false;
    if (!enrichment) return false;
    const programId = enrichment.protocolProgramId;
    return programId ? ClassificationService.STAKING_PROGRAMS.has(programId) : false;
  }

  private getDestinationAddress(transfers: any[], walletAddress: string): string | null {
    const walletAddr = walletAddress.toLowerCase();
    for (const t of transfers) {
      const from = (t.from ?? '').toLowerCase();
      const fromUser = (t.fromUserAccount ?? '').toLowerCase();
      if (from === walletAddr || fromUser === walletAddr) {
        return t.to ?? t.toUserAccount ?? null;
      }
    }
    return null;
  }

  private getSourceAddress(transfers: any[], walletAddress: string): string | null {
    const walletAddr = walletAddress.toLowerCase();
    for (const t of transfers) {
      const to = (t.to ?? '').toLowerCase();
      const toUser = (t.toUserAccount ?? '').toLowerCase();
      if (to === walletAddr || toUser === walletAddr) {
        return t.from ?? t.fromUserAccount ?? null;
      }
    }
    return null;
  }

  private calculatePriority(tx: any): number {
    const value = tx.totalValueUsd ? Number(tx.totalValueUsd) : 0;
    if (value > 10000) return 10;
    if (value > 1000) return 7;
    if (value > 100) return 5;
    if (value > 10) return 3;
    return 1;
  }
}
