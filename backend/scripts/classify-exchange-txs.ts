/**
 * Backfill classification for exchange transactions.
 * Maps each exchange tx type to the proper TAX_CATEGORY and sets classificationStatus.
 *
 * Usage:
 *   cd backend
 *   NODE_PATH=libs/database/node_modules npx tsx scripts/classify-exchange-txs.ts
 */

import { PrismaClient } from '@prisma/client';

const EXCHANGE_TAX_MAP: Record<string, string> = {
  EXCHANGE_TRADE: 'DISPOSAL_SWAP',
  EXCHANGE_C2C_TRADE: 'DISPOSAL_SWAP',
  EXCHANGE_DEPOSIT: 'TRANSFER_TO_EXCHANGE',
  EXCHANGE_WITHDRAWAL: 'TRANSFER_FROM_EXCHANGE',
  EXCHANGE_FIAT_BUY: 'DISPOSAL_SWAP',
  EXCHANGE_FIAT_SELL: 'DISPOSAL_SALE',
  EXCHANGE_STAKE: 'TRANSFER_INTERNAL',
  EXCHANGE_UNSTAKE: 'TRANSFER_INTERNAL',
  EXCHANGE_INTEREST: 'INCOME_STAKING_REWARD',
  EXCHANGE_DIVIDEND: 'INCOME_OTHER',
  EXCHANGE_DUST_CONVERT: 'DUST',
  EXCHANGE_CONVERT: 'DISPOSAL_SWAP',
  MARGIN_BORROW: 'DEFI_BORROW',
  MARGIN_REPAY: 'DEFI_REPAY',
  MARGIN_INTEREST: 'FEE',
  MARGIN_LIQUIDATION: 'DISPOSAL_SALE',
  FEE: 'FEE',
};

async function main() {
  const prisma = new PrismaClient();

  try {
    // Find all exchange transactions without classificationStatus
    const unclassified = await prisma.$queryRaw<
      Array<{ id: string; type: string; category: string | null }>
    >`
      SELECT "id", "type", "category"
      FROM "transactions"
      WHERE "source" = 'EXCHANGE'
        AND "classificationStatus" IS NULL
    `;

    console.log(`Found ${unclassified.length} unclassified exchange transactions`);

    const stats: Record<string, number> = {};
    let updated = 0;
    let skipped = 0;

    for (const tx of unclassified) {
      const newCategory = EXCHANGE_TAX_MAP[tx.type];

      if (!newCategory) {
        skipped++;
        continue;
      }

      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          category: newCategory,
          classificationStatus: 'AUTO_RESOLVED',
        },
      });

      stats[tx.type] = (stats[tx.type] ?? 0) + 1;
      updated++;

      if (updated <= 5 || updated % 500 === 0) {
        console.log(`  [${updated}] ${tx.type} → ${newCategory}`);
      }
    }

    console.log(`\nUpdated: ${updated}, Skipped: ${skipped}`);
    console.log(`\nBreakdown by type:`);
    for (const [type, count] of Object.entries(stats).sort((a, b) => b[1] - a[1])) {
      const category = EXCHANGE_TAX_MAP[type];
      console.log(`  ${type}: ${count} → ${category}`);
    }

    // Final stats
    const total = await prisma.transaction.count();
    const classified = await prisma.transaction.count({
      where: { classificationStatus: { not: null } },
    });
    const pending = await prisma.transaction.count({
      where: { classificationStatus: 'PENDING' },
    });

    console.log(`\n=== FINAL CLASSIFICATION STATS ===`);
    console.log(`Total: ${total}`);
    console.log(`Classified: ${classified}/${total} (${(classified / total * 100).toFixed(1)}%)`);
    console.log(`Pending review: ${pending}`);
    console.log(`Unclassified: ${total - classified}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
