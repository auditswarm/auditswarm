import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Query 1: Portfolio aggregation grouped by token
  console.log('\n========================================');
  console.log('QUERY 1: Portfolio Aggregation by Token');
  console.log('========================================\n');
  const q1 = await prisma.$queryRaw`
    SELECT 
      COALESCE(tf."symbol", tf."mint") AS token,
      tf."decimals",
      SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END)::text AS total_in,
      SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END)::text AS total_out,
      (SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END) - SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END))::text AS net,
      COUNT(DISTINCT CASE WHEN tf."exchangeConnectionId" IS NOT NULL THEN tf.id END)::int AS exchange_flows,
      COUNT(DISTINCT CASE WHEN tf."walletId" IS NOT NULL THEN tf.id END)::int AS onchain_flows
    FROM "transaction_flows" tf
    JOIN "transactions" t ON t."id" = tf."transactionId"
    WHERE tf."isFee" = false
    GROUP BY COALESCE(tf."symbol", tf."mint"), tf."decimals"
    HAVING ABS(SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END) - SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END)) > 0.001
    ORDER BY (SUM(CASE WHEN tf."direction" = 'IN' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END) + SUM(CASE WHEN tf."direction" = 'OUT' THEN COALESCE(tf."valueUsd", 0) ELSE 0 END)) DESC
    LIMIT 20
  `;
  console.table(q1);

  // Query 2: SOL flows by transaction type
  console.log('\n========================================');
  console.log('QUERY 2: SOL Flows by Transaction Type');
  console.log('========================================\n');
  const q2 = await prisma.$queryRaw`
    SELECT 
      t."type",
      COALESCE(tf."symbol", tf."mint") AS token,
      tf."direction",
      COUNT(*)::int AS flow_count,
      SUM(tf."amount")::text AS total_amount,
      CASE WHEN tf."walletId" IS NOT NULL THEN 'onchain' ELSE 'exchange' END AS source
    FROM "transaction_flows" tf
    JOIN "transactions" t ON t."id" = tf."transactionId"
    WHERE (tf."mint" = 'So11111111111111111111111111111111111111112' OR tf."symbol" = 'SOL')
      AND tf."isFee" = false
    GROUP BY t."type", COALESCE(tf."symbol", tf."mint"), tf."direction", 
      CASE WHEN tf."walletId" IS NOT NULL THEN 'onchain' ELSE 'exchange' END
    ORDER BY token, source, t."type"
  `;
  console.table(q2);

  // Query 3: USDT, USDC, BRL, BNB, BUSD breakdown
  console.log('\n========================================');
  console.log('QUERY 3: USDT/USDC/BRL/BNB/BUSD by Type');
  console.log('========================================\n');
  const q3 = await prisma.$queryRaw`
    SELECT 
      COALESCE(tf."symbol", tf."mint") AS token,
      t."type",
      tf."direction",
      COUNT(*)::int AS cnt,
      SUM(tf."amount")::text AS total
    FROM "transaction_flows" tf
    JOIN "transactions" t ON t."id" = tf."transactionId"
    WHERE COALESCE(tf."symbol", tf."mint") IN ('USDT', 'USDC', 'BRL', 'BNB', 'BUSD')
      AND tf."isFee" = false
    GROUP BY COALESCE(tf."symbol", tf."mint"), t."type", tf."direction"
    ORDER BY token, t."type", tf."direction"
  `;
  console.table(q3);

  // Query 4: On-chain flows with symbol set
  console.log('\n========================================');
  console.log('QUERY 4: Flows with Symbol Set (by source)');
  console.log('========================================\n');
  const q4 = await prisma.$queryRaw`
    SELECT 
      tf."symbol", tf."mint",
      COUNT(*)::int AS cnt,
      CASE WHEN tf."walletId" IS NOT NULL THEN 'onchain' ELSE 'exchange' END AS source
    FROM "transaction_flows" tf
    WHERE tf."symbol" IS NOT NULL
    GROUP BY tf."symbol", tf."mint", CASE WHEN tf."walletId" IS NOT NULL THEN 'onchain' ELSE 'exchange' END
    ORDER BY cnt DESC
    LIMIT 30
  `;
  console.table(q4);

  // Query 5: Current portfolio query (deposits/withdrawals EXCLUDED)
  console.log('\n========================================');
  console.log('QUERY 5: Current Portfolio (excl deposits/withdrawals)');
  console.log('========================================\n');
  const q5 = await prisma.$queryRaw`
    SELECT
      COALESCE(tf."symbol", tf."mint") AS token,
      tf."decimals",
      SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END)::text AS "totalBought",
      SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END)::text AS "totalSold",
      (SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END) - SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END))::text AS "net"
    FROM "transaction_flows" tf
    JOIN "transactions" t ON t."id" = tf."transactionId"
    WHERE (
      tf."walletId" IS NOT NULL
      OR (
        tf."exchangeConnectionId" IS NOT NULL
        AND t."type" NOT IN ('EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL')
      )
    )
      AND tf."isFee" = false
    GROUP BY COALESCE(tf."symbol", tf."mint"), tf."decimals"
    ORDER BY ABS(SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END) - SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END)) DESC
    LIMIT 20
  `;
  console.table(q5);

  // Query 6: Portfolio WITH deposits/withdrawals included
  console.log('\n========================================');
  console.log('QUERY 6: Portfolio (incl deposits/withdrawals)');
  console.log('========================================\n');
  const q6 = await prisma.$queryRaw`
    SELECT
      COALESCE(tf."symbol", tf."mint") AS token,
      tf."decimals",
      SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END)::text AS "totalBought",
      SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END)::text AS "totalSold",
      (SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END) - SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END))::text AS "net"
    FROM "transaction_flows" tf
    JOIN "transactions" t ON t."id" = tf."transactionId"
    WHERE tf."isFee" = false
    GROUP BY COALESCE(tf."symbol", tf."mint"), tf."decimals"
    ORDER BY ABS(SUM(CASE WHEN tf."direction" = 'IN' THEN tf."amount" ELSE 0 END) - SUM(CASE WHEN tf."direction" = 'OUT' THEN tf."amount" ELSE 0 END)) DESC
    LIMIT 20
  `;
  console.table(q6);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
