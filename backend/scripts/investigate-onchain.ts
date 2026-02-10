/**
 * Investigate on-chain transactions that correspond to exchange deposits
 * and withdrawals in AuditSwarm.
 *
 * Usage:
 *   cd backend && NODE_PATH=libs/database/node_modules npx tsx scripts/investigate-onchain.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('='.repeat(80));
  console.log('AuditSwarm: On-Chain Exchange Transaction Investigation');
  console.log('='.repeat(80));

  // Query 1
  console.log('\n--- Query 1: On-chain transaction types (TRANSFER_IN, TRANSFER_OUT, UNKNOWN) ---\n');
  const q1: any[] = await prisma.$queryRawUnsafe(`
    SELECT t.type, t.status, COUNT(*)::int AS cnt,
      SUM(COALESCE(t."totalValueUsd", 0))::text AS total_usd
    FROM transactions t
    WHERE t.source = 'ONCHAIN'
      AND t.type IN ('TRANSFER_IN', 'TRANSFER_OUT', 'UNKNOWN')
    GROUP BY t.type, t.status
    ORDER BY cnt DESC
  `);
  console.table(q1);

  // Query 2
  console.log('\n--- Query 2: On-chain TRANSFER_OUT/IN with SOL flows ---\n');
  const q2: any[] = await prisma.$queryRawUnsafe(`
    SELECT 
      t.type,
      COUNT(*)::int AS tx_count,
      COUNT(DISTINCT tf.id)::int AS flow_count,
      SUM(CASE WHEN tf.direction = 'OUT' THEN tf.amount ELSE 0 END)::text AS total_out
    FROM transactions t
    JOIN transaction_flows tf ON tf."transactionId" = t.id
    WHERE t.source = 'ONCHAIN'
      AND t.type IN ('TRANSFER_OUT', 'TRANSFER_IN')
      AND tf.mint = 'So11111111111111111111111111111111111111112'
    GROUP BY t.type
  `);
  console.table(q2);

  // Query 3
  console.log('\n--- Query 3: UNKNOWN on-chain transactions - with vs without flows ---\n');
  const q3: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(DISTINCT t.id)::int AS total_unknown,
      COUNT(DISTINCT CASE WHEN tf.id IS NOT NULL THEN t.id END)::int AS with_flows,
      COUNT(DISTINCT CASE WHEN tf.id IS NULL THEN t.id END)::int AS without_flows
    FROM transactions t
    LEFT JOIN transaction_flows tf ON tf."transactionId" = t.id
    WHERE t.source = 'ONCHAIN' AND t.type = 'UNKNOWN'
  `);
  console.table(q3);

  // Query 4
  console.log('\n--- Query 4: Transactions with linkedTransactionId set ---\n');
  const q4: any[] = await prisma.$queryRawUnsafe(`
    SELECT t.id, t.type, t.source, t."linkedTransactionId", t.signature,
      lt.type AS linked_type, lt.source AS linked_source
    FROM transactions t
    LEFT JOIN transactions lt ON lt.id = t."linkedTransactionId"
    WHERE t."linkedTransactionId" IS NOT NULL
    LIMIT 20
  `);
  if (q4.length === 0) {
    console.log('  (no rows - no linked transactions found)');
  } else {
    console.table(q4);
  }

  // Query 5
  console.log('\n--- Query 5: Sample 10 TRANSFER_OUT transactions - raw transfers JSON ---\n');
  const q5: any[] = await prisma.$queryRawUnsafe(`
    SELECT t.id, t.signature, t.type, t.timestamp::text,
      t.transfers::text AS transfers_raw
    FROM transactions t
    WHERE t.source = 'ONCHAIN' AND t.type = 'TRANSFER_OUT'
    ORDER BY t.timestamp DESC
    LIMIT 10
  `);
  for (const row of q5) {
    console.log('  TX ' + row.id + '  sig=' + (row.signature || '').slice(0, 20) + '...  ' + row.timestamp);
    try {
      const parsed = JSON.parse(row.transfers_raw || '[]');
      for (const xfer of parsed) {
        console.log('    -> from=' + (xfer.fromUserAccount || xfer.from || '?') + '  to=' + (xfer.toUserAccount || xfer.to || '?') + '  amount=' + (xfer.amount ?? '?'));
      }
    } catch {
      console.log('    (raw) ' + (row.transfers_raw || '').slice(0, 200));
    }
    console.log();
  }

  // Query 6
  console.log('\n--- Query 6: Known addresses - exchange-related ---\n');
  const q6: any[] = await prisma.$queryRawUnsafe(`
    SELECT * FROM known_addresses
    WHERE label ILIKE '%binance%' OR label ILIKE '%exchange%'
    LIMIT 20
  `);
  if (q6.length === 0) {
    console.log('  (no rows matching binance/exchange in known_addresses)');
  } else {
    console.table(q6);
  }

  // Query 7
  console.log('\n--- Query 7: UNKNOWN on-chain transactions - null/empty transfers breakdown ---\n');
  const q7: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(CASE WHEN t.transfers IS NULL THEN 1 END)::int AS null_transfers,
      COUNT(CASE WHEN t.transfers::text = '[]' THEN 1 END)::int AS empty_transfers,
      COUNT(CASE WHEN t.transfers IS NOT NULL AND t.transfers::text \!= '[]' THEN 1 END)::int AS has_transfers
    FROM transactions t
    WHERE t.source = 'ONCHAIN' AND t.type = 'UNKNOWN'
  `);
  console.table(q7);

  console.log('\n' + '='.repeat(80));
  console.log('Investigation complete.');
  console.log('='.repeat(80));
}

main()
  .catch((err) => {
    console.error('ERROR:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
