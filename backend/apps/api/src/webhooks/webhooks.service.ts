import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUES, JOB_NAMES, IndexTransactionJobData } from '@auditswarm/queue';
import { WebhookRegistrationRepository } from '@auditswarm/database';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private webhookRepo: WebhookRegistrationRepository,
    @InjectQueue(QUEUES.INDEXER) private indexerQueue: Queue,
  ) {}

  async validateAuthHeader(authHeader: string): Promise<boolean> {
    const activeWebhooks = await this.webhookRepo.findActive();
    return activeWebhooks.some(w => w.authHeader === authHeader);
  }

  async processHeliusWebhook(
    authHeader: string,
    payload: any[],
  ): Promise<{ received: boolean }> {
    // Validate auth
    const isValid = await this.validateAuthHeader(authHeader);
    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook auth header');
    }

    if (!Array.isArray(payload) || payload.length === 0) {
      return { received: true };
    }

    // Group transactions by wallet address
    const txsByAddress = new Map<string, any[]>();

    for (const tx of payload) {
      // Helius enhanced webhooks include account addresses in the data
      const accounts = new Set<string>();

      for (const nt of tx.nativeTransfers ?? []) {
        if (nt.fromUserAccount) accounts.add(nt.fromUserAccount);
        if (nt.toUserAccount) accounts.add(nt.toUserAccount);
      }
      for (const tt of tx.tokenTransfers ?? []) {
        if (tt.fromUserAccount) accounts.add(tt.fromUserAccount);
        if (tt.toUserAccount) accounts.add(tt.toUserAccount);
      }
      if (tx.feePayer) accounts.add(tx.feePayer);

      for (const addr of accounts) {
        if (!txsByAddress.has(addr)) {
          txsByAddress.set(addr, []);
        }
        txsByAddress.get(addr)!.push(tx);
      }
    }

    // Queue INDEX_TRANSACTION jobs with high priority
    for (const [address, txs] of txsByAddress) {
      const jobData: IndexTransactionJobData = {
        walletAddress: address,
        enrichedTransactions: txs,
        source: 'webhook',
      };

      await this.indexerQueue.add(JOB_NAMES.INDEX_TRANSACTION, jobData, {
        priority: 1,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
    }

    this.logger.log(
      `Received ${payload.length} webhook transactions for ${txsByAddress.size} addresses`,
    );

    return { received: true };
  }
}
