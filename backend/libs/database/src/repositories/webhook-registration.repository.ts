import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { WebhookRegistration, Prisma } from '@prisma/client';

@Injectable()
export class WebhookRegistrationRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.WebhookRegistrationCreateInput): Promise<WebhookRegistration> {
    return this.prisma.webhookRegistration.create({ data });
  }

  async findActive(): Promise<WebhookRegistration[]> {
    return this.prisma.webhookRegistration.findMany({
      where: { status: 'ACTIVE' },
    });
  }

  async findByHeliusId(heliusWebhookId: string): Promise<WebhookRegistration | null> {
    return this.prisma.webhookRegistration.findUnique({
      where: { heliusWebhookId },
    });
  }

  async update(
    id: string,
    data: Prisma.WebhookRegistrationUpdateInput,
  ): Promise<WebhookRegistration> {
    return this.prisma.webhookRegistration.update({
      where: { id },
      data,
    });
  }

  async findWithCapacity(maxAddresses: number = 100): Promise<WebhookRegistration | null> {
    // Find an active webhook that hasn't reached its address limit
    const webhooks = await this.prisma.webhookRegistration.findMany({
      where: { status: 'ACTIVE' },
    });

    for (const webhook of webhooks) {
      const addresses = webhook.accountAddresses as string[];
      if (addresses.length < maxAddresses) {
        return webhook;
      }
    }

    return null;
  }
}
