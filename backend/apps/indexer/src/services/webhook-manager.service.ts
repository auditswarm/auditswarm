import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WebhookRegistrationRepository } from '@auditswarm/database';
import { HeliusService } from './helius.service';
import { randomBytes } from 'crypto';

const MAX_WEBHOOKS = 3; // Helius Starter plan limit
const MAX_ADDRESSES_PER_WEBHOOK = 100;

@Injectable()
export class WebhookManagerService implements OnModuleInit {
  private readonly logger = new Logger(WebhookManagerService.name);

  constructor(
    private webhookRepo: WebhookRegistrationRepository,
    private heliusService: HeliusService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.syncWebhooks();
  }

  async registerAddress(address: string): Promise<void> {
    this.logger.log(`Registering webhook for address ${address}`);

    const webhookUrl = this.getWebhookUrl();
    if (webhookUrl.includes('localhost') || webhookUrl.includes('127.0.0.1')) {
      this.logger.warn(
        `Skipping webhook registration — WEBHOOK_BASE_URL is localhost (${webhookUrl}). ` +
        `Set WEBHOOK_BASE_URL to a public URL (e.g. ngrok) to enable real-time webhooks.`,
      );
      return;
    }

    // Find existing webhook with capacity
    const existing = await this.webhookRepo.findWithCapacity(MAX_ADDRESSES_PER_WEBHOOK);

    if (existing) {
      // Add address to existing webhook
      const addresses = existing.accountAddresses as string[];
      if (addresses.includes(address)) {
        this.logger.log(`Address ${address} already registered in webhook ${existing.heliusWebhookId}`);
        return;
      }

      const updatedAddresses = [...addresses, address];

      await this.heliusService.updateWebhook(existing.heliusWebhookId, {
        accountAddresses: updatedAddresses,
      });

      await this.webhookRepo.update(existing.id, {
        accountAddresses: updatedAddresses,
      });

      this.logger.log(`Added address ${address} to webhook ${existing.heliusWebhookId}`);
      return;
    }

    // Check if we can create a new webhook
    const activeWebhooks = await this.webhookRepo.findActive();
    if (activeWebhooks.length >= MAX_WEBHOOKS) {
      this.logger.warn(`Cannot create new webhook — limit reached (${MAX_WEBHOOKS})`);
      return;
    }

    // Create new webhook
    const authHeader = this.generateAuthHeader();

    const webhook = await this.heliusService.createWebhook({
      webhookURL: webhookUrl,
      accountAddresses: [address],
      webhookType: 'enhanced',
      authHeader,
    });

    await this.webhookRepo.create({
      heliusWebhookId: webhook.webhookID,
      webhookUrl,
      webhookType: 'enhanced',
      accountAddresses: [address],
      transactionTypes: ['Any'],
      status: 'ACTIVE',
      authHeader,
    });

    this.logger.log(`Created webhook ${webhook.webhookID} for address ${address}`);
  }

  async unregisterAddress(address: string): Promise<void> {
    this.logger.log(`Unregistering webhook for address ${address}`);

    const webhookUrl = this.getWebhookUrl();
    if (webhookUrl.includes('localhost') || webhookUrl.includes('127.0.0.1')) {
      return;
    }

    const activeWebhooks = await this.webhookRepo.findActive();

    for (const webhook of activeWebhooks) {
      const addresses = webhook.accountAddresses as string[];
      if (!addresses.includes(address)) continue;

      const updatedAddresses = addresses.filter(a => a !== address);

      if (updatedAddresses.length === 0) {
        // Delete the webhook entirely
        await this.heliusService.deleteWebhook(webhook.heliusWebhookId);
        await this.webhookRepo.update(webhook.id, { status: 'DELETED' });
        this.logger.log(`Deleted empty webhook ${webhook.heliusWebhookId}`);
      } else {
        await this.heliusService.updateWebhook(webhook.heliusWebhookId, {
          accountAddresses: updatedAddresses,
        });
        await this.webhookRepo.update(webhook.id, {
          accountAddresses: updatedAddresses,
        });
        this.logger.log(`Removed address ${address} from webhook ${webhook.heliusWebhookId}`);
      }
      return;
    }

    this.logger.warn(`Address ${address} not found in any active webhook`);
  }

  async syncWebhooks(): Promise<void> {
    this.logger.log('Syncing webhooks with Helius...');

    try {
      const remoteWebhooks = await this.heliusService.getAllWebhooks();
      const localWebhooks = await this.webhookRepo.findActive();

      const remoteIds = new Set(remoteWebhooks.map((w: any) => w.webhookID));
      const localIds = new Set(localWebhooks.map(w => w.heliusWebhookId));

      // Mark local webhooks that no longer exist remotely
      for (const local of localWebhooks) {
        if (!remoteIds.has(local.heliusWebhookId)) {
          this.logger.warn(`Webhook ${local.heliusWebhookId} no longer exists on Helius, marking as DELETED`);
          await this.webhookRepo.update(local.id, { status: 'DELETED' });
        }
      }

      // Log remote webhooks not tracked locally
      for (const remote of remoteWebhooks) {
        if (!localIds.has(remote.webhookID)) {
          this.logger.warn(`Untracked Helius webhook found: ${remote.webhookID}`);
        }
      }

      this.logger.log(`Webhook sync complete: ${localWebhooks.length} local, ${remoteWebhooks.length} remote`);
    } catch (error) {
      this.logger.warn(`Webhook sync failed: ${error}`);
    }
  }

  private getWebhookUrl(): string {
    const baseUrl = this.configService.get<string>('WEBHOOK_BASE_URL', 'http://localhost:3001');
    return `${baseUrl}/v1/webhooks/helius`;
  }

  private generateAuthHeader(): string {
    return randomBytes(32).toString('hex');
  }

  async validateAuthHeader(authHeader: string): Promise<boolean> {
    const activeWebhooks = await this.webhookRepo.findActive();
    return activeWebhooks.some(w => w.authHeader === authHeader);
  }
}
