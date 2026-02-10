import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // QUERY 1: Exchange transaction type breakdown with flow analysis
  console.log("\n========================================================");
  console.log("QUERY 1: Exchange Transaction Type Breakdown + Flow Analysis");
  console.log("========================================================\n");
  const q1 = await prisma.$queryRaw`
    SELECT 
      t."type",
      COUNT(DISTINCT t.id)::int AS tx_count,
      COUNT(tf.id)::int AS flow_count,
      COUNT(DISTINCT CASE WHEN tf."direction" = 'IN' THEN tf.id END)::int AS in_flows,
      COUNT(DISTINCT CASE WHEN tf."direction" = 'OUT' THEN tf.id END)::int AS out_flows,
      COUNT(DISTINCT CASE WHEN tf."isFee" = true THEN tf.id END)::int AS fee_flows,
      SUM(CASE WHEN tf."direction" = 'IN' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)::text AS total_in_usd,
      SUM(CASE WHEN tf."direction" = 'OUT' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)::text AS total_out_usd
    FROM transactions t
    LEFT JOIN transaction_flows tf ON tf."transactionId" = t.id
    WHERE t.source = 'EXCHANGE'
    GROUP BY t."type"
    ORDER BY tx_count DESC
  `;
  console.table(q1);

  // QUERY 2: EXCHANGE_TRADE flow patterns (tokens IN vs OUT)
  console.log("\n========================================================");
  console.log("QUERY 2: EXCHANGE_TRADE Flow Patterns (Tokens IN vs OUT)");
  console.log("========================================================\n");
  const q2 = await prisma.$queryRaw`
    SELECT 
      COALESCE(tf.symbol, tf.mint) AS token,
      tf.direction,
      COUNT(*)::int AS flows,
      SUM(tf.amount)::text AS total_amount,
      SUM(COALESCE(tf."valueUsd", 0))::text AS total_usd
    FROM transaction_flows tf
    JOIN transactions t ON t.id = tf."transactionId"
    WHERE t.type = 'EXCHANGE_TRADE'
      AND tf."isFee" = false
    GROUP BY COALESCE(tf.symbol, tf.mint), tf.direction
    ORDER BY token, tf.direction
  `;
  console.table(q2);

  // QUERY 3: EXCHANGE_CONVERT flow patterns
  console.log("\n========================================================");
  console.log("QUERY 3: EXCHANGE_CONVERT Flow Patterns");
  console.log("========================================================\n");
  const q3 = await prisma.$queryRaw`
    SELECT 
      COALESCE(tf.symbol, tf.mint) AS token,
      tf.direction,
      COUNT(*)::int AS flows,
      SUM(tf.amount)::text AS total_amount,
      SUM(COALESCE(tf."valueUsd", 0))::text AS total_usd
    FROM transaction_flows tf
    JOIN transactions t ON t.id = tf."transactionId"
    WHERE t.type = 'EXCHANGE_CONVERT'
      AND tf."isFee" = false
    GROUP BY COALESCE(tf.symbol, tf.mint), tf.direction
    ORDER BY token, tf.direction
  `;
  console.table(q3);

  // QUERY 4: Sample 5 EXCHANGE_TRADE transactions with structure
  console.log("\n========================================================");
  console.log("QUERY 4: Sample 5 EXCHANGE_TRADE Transactions (Structure)");
  console.log("========================================================\n");
  const q4 = await prisma.$queryRaw`
    SELECT t.id, t.type, t."externalId", t.timestamp::text, t."totalValueUsd"::text,
      jsonb_pretty(t.transfers::jsonb) as transfers_json
    FROM transactions t
    WHERE t.type = 'EXCHANGE_TRADE'
    ORDER BY t.timestamp DESC
    LIMIT 5
  `;
  console.table(q4);

  // QUERY 5: Deposit/Withdrawal on-chain data from rawData
  console.log("\n========================================================");
  console.log("QUERY 5: Deposit/Withdrawal On-Chain Data from rawData");
  console.log("========================================================\n");
  const q5 = await prisma.$queryRaw`
    SELECT t.type, t."externalId",
      t."rawData"->>'txId' AS onchain_txid,
      t."rawData"->>'id' AS raw_id,
      t."rawData"->>'network' AS network,
      t.timestamp::text,
      COALESCE(tf.symbol, tf.mint) AS token,
      tf.direction,
      tf.amount::text
    FROM transactions t
    LEFT JOIN transaction_flows tf ON tf."transactionId" = t.id AND tf."isFee" = false
    WHERE t.type IN ('EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL')
    ORDER BY t.timestamp DESC
    LIMIT 20
  `;
  console.table(q5);

  // QUERY 6: Match exchange deposits/withdrawals to on-chain txs
  console.log("\n========================================================");
  console.log("QUERY 6: Exchange <-> On-Chain Transaction Matching by txId");
  console.log("========================================================\n");
  const q6 = await prisma.$queryRaw`
    WITH exchange_txids AS (
      SELECT t.id AS exchange_tx_id, t.type, t."rawData"->>'txId' AS txid,
        t.timestamp, COALESCE(tf.symbol, tf.mint) AS token, tf.amount::text
      FROM transactions t
      LEFT JOIN transaction_flows tf ON tf."transactionId" = t.id AND tf."isFee" = false
      WHERE t.type IN ('EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL')
        AND t."rawData"->>'txId' IS NOT NULL
      LIMIT 50
    )
    SELECT e.exchange_tx_id, e.type, e.token, e.amount, 
      t.id AS onchain_tx_id, t.type AS onchain_type, t.signature
    FROM exchange_txids e
    LEFT JOIN transactions t ON t.signature = e.txid AND t.source = 'ONCHAIN'
    LIMIT 20
  `;
  console.table(q6);

  // QUERY 7: EXCHANGE_STAKE token flows (IN vs OUT)
  console.log("\n========================================================");
  console.log("QUERY 7: EXCHANGE_STAKE Token Flows (IN vs OUT)");
  console.log("========================================================\n");
  const q7 = await prisma.$queryRaw`
    SELECT 
      COALESCE(tf.symbol, tf.mint) AS token,
      tf.direction,
      COUNT(*)::int AS flows,
      SUM(tf.amount)::text AS total_amount
    FROM transaction_flows tf
    JOIN transactions t ON t.id = tf."transactionId"
    WHERE t.type = 'EXCHANGE_STAKE'
      AND tf."isFee" = false
    GROUP BY COALESCE(tf.symbol, tf.mint), tf.direction
    ORDER BY token, tf.direction
  `;
  console.table(q7);

  // QUERY 8: Net exchange balance per token (all exchange flows)
  console.log("\n========================================================");
  console.log("QUERY 8: Net Exchange Balance Per Token (All Exchange Flows)");
  console.log("========================================================\n");
  const q8 = await prisma.$queryRaw`
    SELECT 
      COALESCE(tf.symbol, tf.mint) AS token,
      SUM(CASE WHEN tf.direction = 'IN' THEN tf.amount ELSE 0 END)::text AS total_in,
      SUM(CASE WHEN tf.direction = 'OUT' THEN tf.amount ELSE 0 END)::text AS total_out,
      (SUM(CASE WHEN tf.direction = 'IN' THEN tf.amount ELSE 0 END) - SUM(CASE WHEN tf.direction = 'OUT' THEN tf.amount ELSE 0 END))::text AS net,
      SUM(CASE WHEN tf.direction = 'IN' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)::text AS in_usd,
      SUM(CASE WHEN tf.direction = 'OUT' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)::text AS out_usd
    FROM transaction_flows tf
    JOIN transactions t ON t.id = tf."transactionId"
    WHERE t.source = 'EXCHANGE'
      AND tf."isFee" = false
    GROUP BY COALESCE(tf.symbol, tf.mint)
    ORDER BY ABS(SUM(CASE WHEN tf.direction = 'IN' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END) + SUM(CASE WHEN tf.direction = 'OUT' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)) DESC
    LIMIT 20
  `;
  console.table(q8);
}

main()
  .catch((e) => {
    console.error('Error running investigation:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
