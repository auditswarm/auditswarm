import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PendingClassificationRepository,
  TransactionRepository,
} from '@auditswarm/database';
import { getAllTaxCategories } from '@auditswarm/common';
import type { PendingClassification } from '@prisma/client';

@Injectable()
export class ClassificationsService {
  constructor(
    private classificationRepo: PendingClassificationRepository,
    private transactionRepo: TransactionRepository,
  ) {}

  async getPending(
    userId: string,
    options?: { take?: number; skip?: number },
  ): Promise<PendingClassification[]> {
    return this.classificationRepo.findPendingByUserId(userId, options);
  }

  async getStats(userId: string) {
    return this.classificationRepo.getStats(userId);
  }

  async getCategories() {
    return getAllTaxCategories();
  }

  async resolve(
    id: string,
    userId: string,
    category: string,
    notes?: string,
  ): Promise<PendingClassification> {
    const classification = await this.classificationRepo.findById(id);
    if (!classification || classification.userId !== userId) {
      throw new NotFoundException('Classification not found');
    }

    const resolved = await this.classificationRepo.resolve(id, category, notes);

    // Update the transaction's classification status and category
    if (resolved.transactionId) {
      await this.transactionRepo.update(resolved.transactionId, {
        category,
        classificationStatus: 'CLASSIFIED',
      });
    }

    return resolved;
  }

  async batchResolve(
    userId: string,
    ids: string[],
    category: string,
  ): Promise<{ count: number }> {
    const result = await this.classificationRepo.batchResolve(ids, category);

    // Update all related transactions
    for (const id of ids) {
      const classification = await this.classificationRepo.findById(id);
      if (classification?.transactionId) {
        await this.transactionRepo.update(classification.transactionId, {
          category,
          classificationStatus: 'CLASSIFIED',
        });
      }
    }

    return result;
  }
}
