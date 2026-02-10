/**
 * Reclassify Meteora DLMM LP transactions.
 *
 * Finds all transactions where rawData contains the Meteora DLMM program ID,
 * determines LP_DEPOSIT vs LP_WITHDRAW from tokenTransfers direction,
 * and updates the transaction type and classification.
 *
 * Usage:
 *   cd backend
 *   NODE_PATH=libs/database/node_modules npx tsx scripts/reclassify-lp.ts
 */

import { PrismaClient } from '@prisma/client';

const METEORA_DLMM = 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo';

async function main() {
  const prisma = new PrismaClient();

  try {
    // Find all transactions that involve the Meteora DLMM program
    // We search rawData JSON for the program ID
    const searchPattern = `%${METEORA_DLMM}%`;
    const candidates = await prisma.$queryRaw<
      Array<{
        id: string;
        walletId: string;
        type: string;
        signature: string;
        rawData: any;
        classificationStatus: string | null;
      }>
    >`
      SELECT t."id", t."walletId", t."type", t."signature",
             t."rawData", t."classificationStatus"
      FROM "transactions" t
      WHERE t."rawData"::text LIKE ${searchPattern}
        AND t."walletId" IS NOT NULL
    `;

    console.log(`Found ${candidates.length} transactions involving Meteora DLMM`);

    if (candidates.length === 0) {
      console.log('Nothing to reclassify.');
      return;
    }

    // Resolve wallet addresses
    const walletIds = [...new Set(candidates.map(c => c.walletId))];
    const wallets = await prisma.wallet.findMany({
      where: { id: { in: walletIds } },
      select: { id: true, address: true },
    });
    const walletAddressMap = new Map(wallets.map(w => [w.id, w.address]));

    let reclassified = 0;
    let skipped = 0;

    for (const tx of candidates) {
      const walletAddress = walletAddressMap.get(tx.walletId);
      if (!walletAddress) {
        console.log(`  SKIP ${tx.signature?.slice(0, 12)}... — no wallet address`);
        skipped++;
        continue;
      }

      const rawData = tx.rawData as any;
      const addr = walletAddress.toLowerCase();

      // Determine direction from tokenTransfers
      let hasOut = false;
      let hasIn = false;

      for (const tt of rawData?.tokenTransfers ?? []) {
        const from = (tt.fromUserAccount ?? '').toLowerCase();
        const to = (tt.toUserAccount ?? '').toLowerCase();
        if (from === addr) hasOut = true;
        if (to === addr) hasIn = true;
      }

      // Also check nativeTransfers
      for (const nt of rawData?.nativeTransfers ?? []) {
        const from = (nt.fromUserAccount ?? '').toLowerCase();
        const to = (nt.toUserAccount ?? '').toLowerCase();
        if (from === addr && (nt.amount ?? 0) > 0) hasOut = true;
        if (to === addr && (nt.amount ?? 0) > 0) hasIn = true;
      }

      let newType: string;
      if (hasOut && !hasIn) {
        newType = 'LP_DEPOSIT';
      } else if (hasIn && !hasOut) {
        newType = 'LP_WITHDRAW';
      } else if (hasOut && hasIn) {
        newType = 'LP_DEPOSIT'; // rebalance — tokens go out and LP tokens come in
      } else {
        console.log(`  SKIP ${tx.signature?.slice(0, 12)}... — no transfers detected`);
        skipped++;
        continue;
      }

      const oldType = tx.type;
      if (oldType === newType) {
        console.log(`  SKIP ${tx.signature?.slice(0, 12)}... — already ${newType}`);
        skipped++;
        continue;
      }

      // Update transaction type and classification
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          type: newType,
          category: newType === 'LP_DEPOSIT' ? 'DEFI_LP_ADD' : 'DEFI_LP_REMOVE',
          classificationStatus: 'CLASSIFIED',
        },
      });

      console.log(`  ${tx.signature?.slice(0, 12)}... ${oldType} → ${newType}`);
      reclassified++;
    }

    console.log(`\nDone: ${reclassified} reclassified, ${skipped} skipped`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
