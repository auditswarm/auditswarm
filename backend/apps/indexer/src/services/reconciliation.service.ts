import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TransactionFlowRepository, TransactionRepository } from '@auditswarm/database';
import { PrismaService } from '@auditswarm/database';
import { BackfillService } from './backfill.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);
  private running = false;

  constructor(
    private prisma: PrismaService,
    private flowRepo: TransactionFlowRepository,
    private transactionRepo: TransactionRepository,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileOrphanedTransactions(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      // Find transactions that have no corresponding flows (limit batch to 500)
      const orphaned = await this.prisma.transaction.findMany({
        where: {
          flows: { none: {} },
          // Only look at completed wallets to avoid race with backfill
          wallet: { syncState: { status: 'COMPLETED' } },
        },
        select: {
          id: true,
          walletId: true,
          type: true,
          totalValueUsd: true,
          rawData: true,
          fee: true,
          feePayer: true,
          wallet: { select: { address: true } },
        },
        take: 500,
        orderBy: { timestamp: 'asc' },
      });

      if (orphaned.length === 0) return;

      this.logger.log(`Reconciliation: found ${orphaned.length} transactions without flows`);

      let created = 0;
      const allFlows: Prisma.TransactionFlowCreateManyInput[] = [];

      for (const tx of orphaned) {
        if (!tx.walletId || !tx.wallet) continue;
        const flows = BackfillService.extractFlows(
          tx.id,
          tx.walletId,
          tx.wallet.address,
          tx.rawData,
          tx.type,
          tx.totalValueUsd ? Number(tx.totalValueUsd) : 0,
          tx.fee ?? BigInt(0),
          tx.feePayer ?? '',
        );
        allFlows.push(...flows);
        if (flows.length > 0) created++;
      }

      if (allFlows.length > 0) {
        await this.flowRepo.createMany(allFlows);
      }

      this.logger.log(
        `Reconciliation complete: ${created}/${orphaned.length} transactions got flows (${allFlows.length} flow records)`,
      );
    } catch (error) {
      this.logger.error(`Reconciliation failed: ${error}`);
    } finally {
      this.running = false;
    }
  }
}
