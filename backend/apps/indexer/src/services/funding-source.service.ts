import { Injectable, Logger } from '@nestjs/common';
import {
  TransactionRepository,
  WalletFundingSourceRepository,
  KnownAddressRepository,
  CounterpartyWalletRepository,
} from '@auditswarm/database';
import { Prisma } from '@prisma/client';

@Injectable()
export class FundingSourceService {
  private readonly logger = new Logger(FundingSourceService.name);
  private static readonly SOL_MINT = 'So11111111111111111111111111111111111111112';

  constructor(
    private transactionRepo: TransactionRepository,
    private fundingSourceRepo: WalletFundingSourceRepository,
    private knownAddressRepo: KnownAddressRepository,
    private counterpartyRepo: CounterpartyWalletRepository,
  ) {}

  async detectFundingSource(
    walletId: string,
    walletAddress: string,
  ): Promise<void> {
    // Skip if already detected
    const existing = await this.fundingSourceRepo.findByWalletId(walletId);
    if (existing) {
      this.logger.debug(`Funding source already detected for wallet ${walletId}`);
      return;
    }

    // Get earliest transactions for this wallet
    const earliestTxs = await this.transactionRepo.findByWalletId(walletId, {
      take: 10,
      orderBy: 'asc',
    });

    if (earliestTxs.length === 0) {
      this.logger.debug(`No transactions found for wallet ${walletId}`);
      return;
    }

    // Find the first SOL transfer IN — that's the funder
    for (const tx of earliestTxs) {
      if (tx.type !== 'TRANSFER_IN') continue;

      const transfers = (tx.transfers as any[] | null) ?? [];
      const walletAddr = walletAddress.toLowerCase();

      for (const transfer of transfers) {
        // Check if this is a SOL transfer to our wallet
        const toAddr = (transfer.to ?? '').toLowerCase();
        const toUserAccount = (transfer.toUserAccount ?? '').toLowerCase();
        const isToWallet = toAddr === walletAddr || toUserAccount === walletAddr;
        const isSol = !transfer.mint || transfer.mint === FundingSourceService.SOL_MINT;

        if (!isToWallet || !isSol) continue;

        const funderAddress = transfer.from ?? transfer.fromUserAccount;
        if (!funderAddress) continue;

        // Resolve label
        let funderLabel: string | undefined;
        let funderEntityType: string | undefined;

        const knownAddr = await this.knownAddressRepo.findByAddress(funderAddress);
        if (knownAddr) {
          funderLabel = knownAddr.label;
          funderEntityType = knownAddr.entityType;
        } else {
          const counterparty = await this.counterpartyRepo.findByAddress(funderAddress);
          if (counterparty?.label) {
            funderLabel = counterparty.label;
            funderEntityType = counterparty.entityType ?? 'UNKNOWN';
          }
        }

        // Calculate lamports from transfer amount
        const amountSol = transfer.amount ?? 0;
        const amountLamports = BigInt(Math.round(amountSol * 1e9));

        await this.fundingSourceRepo.create({
          walletId,
          funderAddress,
          funderTransactionSignature: tx.signature ?? '',
          funderTransactionTimestamp: tx.timestamp,
          fundedAmountLamports: amountLamports,
          fundedAmountSol: new Prisma.Decimal(amountSol.toFixed(9)),
          funderLabel,
          funderEntityType: funderEntityType ?? 'UNKNOWN',
        });

        this.logger.log(
          `Detected funding source for wallet ${walletId}: ${funderAddress} (${funderLabel ?? 'unknown'})`,
        );
        return;
      }
    }

    this.logger.debug(`No funding source SOL transfer found for wallet ${walletId}`);
  }
}
