import { PrismaClient, Prisma } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Q1: Exchange transaction type breakdown
  console.log("=== Q1: Exchange Transaction Type Breakdown ===");
  const q1 = await prisma.$queryRaw<any[]>`
    SELECT t."type", COUNT(DISTINCT t.id)::int AS tx_count,
      COUNT(tf.id)::int AS flow_count,
      COUNT(DISTINCT CASE WHEN tf."direction" = 'IN' THEN tf.id END)::int AS in_flows,
      COUNT(DISTINCT CASE WHEN tf."direction" = 'OUT' THEN tf.id END)::int AS out_flows,
      COUNT(DISTINCT CASE WHEN tf."isFee" = true THEN tf.id END)::int AS fee_flows
    FROM transactions t
    LEFT JOIN transaction_flows tf ON tf."transactionId" = t.id
    WHERE t.source = 'EXCHANGE'
    GROUP BY t."type" ORDER BY tx_count DESC
  `;
  console.table(q1);

  // Q2: EXCHANGE_TRADE flow patterns
  console.log("=== Q2: EXCHANGE_TRADE Flow Patterns ===");
  const q2 = await prisma.$queryRaw<any[]>`
    SELECT COALESCE(tf.symbol, tf.mint) AS token, tf.direction,
      COUNT(*)::int AS flows, SUM(tf.amount)::text AS total_amount,
      SUM(COALESCE(tf."valueUsd", 0))::text AS total_usd
    FROM transaction_flows tf JOIN transactions t ON t.id = tf."transactionId"
    WHERE t.type = 'EXCHANGE_TRADE' AND tf."isFee" = false
    GROUP BY COALESCE(tf.symbol, tf.mint), tf.direction ORDER BY token, tf.direction
  `;
  console.table(q2);

  // Q3: EXCHANGE_CONVERT flow patterns
  console.log("=== Q3: EXCHANGE_CONVERT Flow Patterns ===");
  const q3 = await prisma.$queryRaw<any[]>`
    SELECT COALESCE(tf.symbol, tf.mint) AS token, tf.direction,
      COUNT(*)::int AS flows, SUM(tf.amount)::text AS total_amount,
      SUM(COALESCE(tf."valueUsd", 0))::text AS total_usd
    FROM transaction_flows tf JOIN transactions t ON t.id = tf."transactionId"
    WHERE t.type = 'EXCHANGE_CONVERT' AND tf."isFee" = false
    GROUP BY COALESCE(tf.symbol, tf.mint), tf.direction ORDER BY token, tf.direction
  `;
  console.table(q3);

  // Q4: Sample EXCHANGE_TRADE transactions
  console.log("=== Q4: Sample 5 EXCHANGE_TRADE Transactions ===");
  const q4 = await prisma.$queryRaw<any[]>`
    SELECT t.id, t."externalId", t.timestamp::text, t."totalValueUsd"::text as usd,
      jsonb_array_length(t.transfers::jsonb) as num_flows
    FROM transactions t WHERE t.type = 'EXCHANGE_TRADE'
    ORDER BY t.timestamp DESC LIMIT 5
  `;
  console.table(q4);

  // Q5: Deposit/Withdrawal with on-chain txId
  console.log("=== Q5: Deposit/Withdrawal On-Chain txId Linking ===");
  const q5 = await prisma.$queryRaw<any[]>`
    SELECT t.type, t."externalId",
      t."rawData"->>'txId' AS onchain_txid,
      t."rawData"->>'network' AS network,
      t.timestamp::text,
      COALESCE(tf.symbol, tf.mint) AS token,
      tf.direction, tf.amount::text
    FROM transactions t
    LEFT JOIN transaction_flows tf ON tf."transactionId" = t.id AND tf."isFee" = false
    WHERE t.type IN ('EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL')
    ORDER BY t.timestamp DESC LIMIT 20
  `;
  console.table(q5);

  // Q6: Can we match exchange txIds to on-chain signatures?
  console.log("=== Q6: Exchange-to-OnChain Matching by txId ===");
  const q6 = await prisma.$queryRaw<any[]>`
    WITH exchange_txids AS (
      SELECT t.id AS exchange_tx_id, t.type,
        t."rawData"->>'txId' AS txid, t.timestamp,
        COALESCE(tf.symbol, tf.mint) AS token, tf.amount::text
      FROM transactions t
      LEFT JOIN transaction_flows tf ON tf."transactionId" = t.id AND tf."isFee" = false
      WHERE t.type IN ('EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL')
        AND t."rawData"->>'txId' IS NOT NULL
      LIMIT 50
    )
    SELECT e.type, e.token, e.amount,
      CASE WHEN oc.id IS NOT NULL THEN 'MATCHED' ELSE 'UNMATCHED' END AS status,
      oc.type AS onchain_type, LEFT(e.txid, 20) AS txid_prefix
    FROM exchange_txids e
    LEFT JOIN transactions oc ON oc.signature = e.txid AND oc.source = 'ONCHAIN'
    LIMIT 20
  `;
  console.table(q6);

  // Q7: EXCHANGE_STAKE patterns
  console.log("=== Q7: EXCHANGE_STAKE Flow Patterns ===");
  const q7 = await prisma.$queryRaw<any[]>`
    SELECT COALESCE(tf.symbol, tf.mint) AS token, tf.direction,
      COUNT(*)::int AS flows, SUM(tf.amount)::text AS total_amount
    FROM transaction_flows tf JOIN transactions t ON t.id = tf."transactionId"
    WHERE t.type = 'EXCHANGE_STAKE' AND tf."isFee" = false
    GROUP BY COALESCE(tf.symbol, tf.mint), tf.direction ORDER BY token, tf.direction
  `;
  console.table(q7);

  // Q8: Net exchange balance per token (ALL exchange flows)
  console.log("=== Q8: Net Exchange Balance Per Token (All Types) ===");
  const q8 = await prisma.$queryRaw<any[]>`
    SELECT COALESCE(tf.symbol, tf.mint) AS token,
      SUM(CASE WHEN tf.direction = 'IN' THEN tf.amount ELSE 0 END)::text AS total_in,
      SUM(CASE WHEN tf.direction = 'OUT' THEN tf.amount ELSE 0 END)::text AS total_out,
      (SUM(CASE WHEN tf.direction = 'IN' THEN tf.amount ELSE 0 END) -
       SUM(CASE WHEN tf.direction = 'OUT' THEN tf.amount ELSE 0 END))::text AS net
    FROM transaction_flows tf JOIN transactions t ON t.id = tf."transactionId"
    WHERE t.source = 'EXCHANGE' AND tf."isFee" = false
    GROUP BY COALESCE(tf.symbol, tf.mint)
    ORDER BY ABS(SUM(CASE WHEN tf.direction = 'IN' THEN COALESCE(tf."valueUsd",0) ELSE 0 END) +
      SUM(CASE WHEN tf.direction = 'OUT' THEN COALESCE(tf."valueUsd",0) ELSE 0 END)) DESC
    LIMIT 20
  `;
  console.table(q8);

  // Q9: On-chain UNKNOWN transactions analysis
  console.log("=== Q9: On-Chain UNKNOWN Transactions ===");
  const q9 = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(CASE WHEN t.transfers IS NULL THEN 1 END)::int AS null_transfers,
      COUNT(CASE WHEN t.transfers::text = '[]' THEN 1 END)::int AS empty_transfers,
      COUNT(CASE WHEN t.transfers IS NOT NULL AND t.transfers::text != '[]' THEN 1 END)::int AS has_transfers
    FROM transactions t WHERE t.source = 'ONCHAIN' AND t.type = 'UNKNOWN'
  `;
  console.table(q9);

  // Q10: Check what tokens appear as fiat/pseudo-mints on exchange
  console.log("=== Q10: Pseudo-Mint/Fiat Tokens on Exchange ===");
  const q10 = await prisma.$queryRaw<any[]>`
    SELECT tf.mint, tf.symbol, COUNT(*)::int AS flows,
      SUM(CASE WHEN tf.direction = 'IN' THEN tf.amount ELSE 0 END)::text AS total_in,
      SUM(CASE WHEN tf.direction = 'OUT' THEN tf.amount ELSE 0 END)::text AS total_out
    FROM transaction_flows tf JOIN transactions t ON t.id = tf."transactionId"
    WHERE t.source = 'EXCHANGE'
      AND (tf.mint LIKE 'fiat:%' OR tf.mint LIKE 'exchange:%' OR tf.mint = 'native')
    GROUP BY tf.mint, tf.symbol ORDER BY flows DESC
  `;
  console.table(q10);

  // Q11: On-chain types summary
  console.log("=== Q11: On-Chain Transaction Types ===");
  const q11 = await prisma.$queryRaw<any[]>`
    SELECT t.type, COUNT(*)::int AS cnt
    FROM transactions t WHERE t.source = 'ONCHAIN'
    GROUP BY t.type ORDER BY cnt DESC
  `;
  console.table(q11);
}

main().catch(e => console.error("Error:", e)).finally(() => prisma.$disconnect());
