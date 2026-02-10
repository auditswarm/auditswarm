/**
 * Reclassify UNKNOWN transactions based on program analysis.
 *
 * Handles:
 * - BPF Loader writes/upgrades → PROGRAM_INTERACTION
 * - Address Lookup Table operations → PROGRAM_INTERACTION
 * - INITIALIZE_ACCOUNT (ATA creation) → PROGRAM_INTERACTION
 * - UPGRADE_PROGRAM_INSTRUCTION → PROGRAM_INTERACTION
 *
 * Usage:
 *   cd backend
 *   NODE_PATH=libs/database/node_modules npx tsx scripts/reclassify-unknown.ts
 */

import { PrismaClient } from '@prisma/client';

const BPF_LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111';
const BPF_LOADER_V2 = 'BPFLoader2111111111111111111111111111111111';
const ADDRESS_LOOKUP = 'AddressLookupTab1e1111111111111111111111111';

async function main() {
  const prisma = new PrismaClient();

  try {
    // 1. Find all UNKNOWN transactions
    const unknowns = await prisma.$queryRaw<
      Array<{
        id: string;
        type: string;
        signature: string;
        rawData: any;
        classificationStatus: string | null;
      }>
    >`
      SELECT t."id", t."type", t."signature",
             t."rawData", t."classificationStatus"
      FROM "transactions" t
      WHERE t."type" IN ('UNKNOWN', 'TRANSFER_OUT')
        AND t."source" = 'ONCHAIN'
        AND t."walletId" IS NOT NULL
    `;

    console.log(`Found ${unknowns.length} UNKNOWN/TRANSFER_OUT on-chain transactions`);

    let reclassified = 0;
    let skipped = 0;

    const stats = {
      bpfLoader: 0,
      addressLookup: 0,
      upgradeProgram: 0,
      initializeAccount: 0,
      unchanged: 0,
    };

    for (const tx of unknowns) {
      const rawData = tx.rawData as any;
      if (!rawData) {
        skipped++;
        continue;
      }

      const heliusType = rawData.type ?? '';
      const instructions: any[] = rawData.instructions ?? [];
      const programIds = new Set<string>();

      for (const ix of instructions) {
        if (ix.programId) programIds.add(ix.programId);
      }

      let newType: string | null = null;
      let reason = '';

      // Check for BPF Loader interactions
      if (programIds.has(BPF_LOADER) || programIds.has(BPF_LOADER_V2)) {
        newType = 'PROGRAM_INTERACTION';
        reason = 'BPF Loader';
        stats.bpfLoader++;
      }
      // Check for Address Lookup Table
      else if (programIds.has(ADDRESS_LOOKUP)) {
        newType = 'PROGRAM_INTERACTION';
        reason = 'Address Lookup Table';
        stats.addressLookup++;
      }
      // Check Helius type
      else if (heliusType === 'UPGRADE_PROGRAM_INSTRUCTION') {
        newType = 'PROGRAM_INTERACTION';
        reason = 'Program Upgrade';
        stats.upgradeProgram++;
      }
      else if (heliusType === 'INITIALIZE_ACCOUNT') {
        newType = 'PROGRAM_INTERACTION';
        reason = 'Account Init';
        stats.initializeAccount++;
      }

      if (!newType || tx.type === newType) {
        stats.unchanged++;
        skipped++;
        continue;
      }

      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          type: newType,
          classificationStatus: 'AUTO_RESOLVED',
          category: 'DUST',
        },
      });

      reclassified++;

      if (reclassified <= 10 || reclassified % 500 === 0) {
        console.log(`  [${reclassified}] ${tx.signature?.slice(0, 16)}... ${tx.type} → ${newType} (${reason})`);
      }
    }

    console.log(`\nReclassified: ${reclassified}, Skipped: ${skipped}`);
    console.log(`Breakdown:`);
    console.log(`  BPF Loader: ${stats.bpfLoader}`);
    console.log(`  Address Lookup Table: ${stats.addressLookup}`);
    console.log(`  Program Upgrade: ${stats.upgradeProgram}`);
    console.log(`  Account Init: ${stats.initializeAccount}`);
    console.log(`  Unchanged: ${stats.unchanged}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
