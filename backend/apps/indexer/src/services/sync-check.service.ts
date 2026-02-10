import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WalletRepository, WalletSyncStateRepository } from '@auditswarm/database';
import { QUEUES, JOB_NAMES } from '@auditswarm/queue';

@Injectable()
export class SyncCheckService implements OnModuleInit {
  private readonly logger = new Logger(SyncCheckService.name);

  constructor(
    private walletRepo: WalletRepository,
    private syncStateRepo: WalletSyncStateRepository,
    @InjectQueue(QUEUES.INDEXER) private indexerQueue: Queue,
  ) {}

  async onModuleInit() {
    // Run on startup with a small delay to let other services initialize
    setTimeout(() => this.checkUnsyncedWallets(), 3000);
  }

  async checkUnsyncedWallets(): Promise<void> {
    this.logger.log('Checking for wallets that need syncing...');

    try {
      // Get all active wallets from all users
      const allWallets = await this.walletRepo.findAllActive();

      let dispatched = 0;

      for (const wallet of allWallets) {
        const syncState = await this.syncStateRepo.findByWalletId(wallet.id);

        // Dispatch backfill if:
        // - No sync state exists (never synced)
        // - Status is IDLE (not started)
        // - Status is FAILED (needs retry)
        const needsSync =
          !syncState ||
          syncState.status === 'IDLE' ||
          syncState.status === 'FAILED';

        if (needsSync) {
          const jobId = `index-wallet-${wallet.id}-${Date.now()}`;
          await this.indexerQueue.add(
            JOB_NAMES.INDEX_WALLET,
            {
              walletId: wallet.id,
              walletAddress: wallet.address,
              fromSignature: syncState?.lastSignature ?? undefined,
            },
            {
              jobId,
              priority: 10,
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
            },
          );
          dispatched++;
          this.logger.log(
            `Dispatched backfill for wallet ${wallet.id} (${wallet.address}) ` +
            `[status: ${syncState?.status ?? 'NO_SYNC_STATE'}]`,
          );
        }
      }

      this.logger.log(
        `Sync check complete: ${allWallets.length} wallets, ${dispatched} need syncing`,
      );
    } catch (error) {
      this.logger.error(`Sync check failed: ${error}`);
    }
  }
}
