/**
 * Backfill USD prices for exchange flows using Birdeye historical price API.
 * Groups flows by mint + hour to minimize API calls.
 *
 * Usage: cd auditswarm/backend && NODE_PATH=libs/database/node_modules npx tsx scripts/backfill-prices.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import https from 'https';

const prisma = new PrismaClient();

const BIRDEYE_BASE = 'https://public-api.birdeye.so';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY ?? 'd9ebeae068da418b8d27c35a76729096';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Rate limiting: 100 requests/sec for Birdeye
let tokens = 100;
let lastRefill = Date.now();

async function acquireToken(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRefill;
  if (elapsed >= 1000) {
    tokens = 100;
    lastRefill = now;
  }
  if (tokens <= 0) {
    await new Promise(resolve => setTimeout(resolve, 1100 - elapsed));
    tokens = 100;
    lastRefill = Date.now();
  }
  tokens--;
}

function fetchJson(url: string, headers: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`Invalid JSON from ${url}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function getHistoricalPrice(mint: string, timestamp: number): Promise<number | null> {
  await acquireToken();

  try {
    const url = `${BIRDEYE_BASE}/defi/history_price?address=${mint}&address_type=token&type=1m&time_from=${timestamp}&time_to=${timestamp + 60}`;
    const response = await fetchJson(url, {
      'X-API-KEY': BIRDEYE_API_KEY,
      'accept': 'application/json',
    });

    const items = response?.data?.items ?? [];
    if (items.length > 0) return items[0].value;

    // Try wider window (5 min)
    const url2 = `${BIRDEYE_BASE}/defi/history_price?address=${mint}&address_type=token&type=5m&time_from=${timestamp - 300}&time_to=${timestamp + 300}`;
    const response2 = await fetchJson(url2, {
      'X-API-KEY': BIRDEYE_API_KEY,
      'accept': 'application/json',
    });

    const items2 = response2?.data?.items ?? [];
    if (items2.length > 0) return items2[0].value;

    return null;
  } catch (error: any) {
    console.error(`  Price fetch failed for ${mint} at ${timestamp}: ${error.message}`);
    return null;
  }
}

// Cache: mint:hourTs → price
const priceCache = new Map<string, number | null>();

async function getCachedPrice(mint: string, timestamp: number): Promise<number | null> {
  const hourTs = Math.floor(timestamp / 3600) * 3600;
  const key = `${mint}:${hourTs}`;

  if (priceCache.has(key)) return priceCache.get(key)!;

  const price = await getHistoricalPrice(mint, hourTs);
  priceCache.set(key, price);
  return price;
}

async function main() {
  console.log('Starting price backfill...\n');

  // Get all exchange flows missing USD values
  const flowsMissingPrice = await prisma.transactionFlow.findMany({
    where: {
      exchangeConnectionId: { not: null },
      valueUsd: null,
    },
    include: {
      transaction: { select: { timestamp: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${flowsMissingPrice.length} exchange flows without USD values`);

  // Also get on-chain flows missing USD values
  const onChainFlows = await prisma.transactionFlow.findMany({
    where: {
      exchangeConnectionId: null,
      valueUsd: null,
      walletId: { not: null },
    },
    include: {
      transaction: { select: { timestamp: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${onChainFlows.length} on-chain flows without USD values`);

  const allFlows = [...flowsMissingPrice, ...onChainFlows];

  // Group by mint + hour to minimize API calls
  const groups = new Map<string, typeof allFlows>();
  for (const flow of allFlows) {
    const hourTs = Math.floor(flow.transaction.timestamp.getTime() / 3600000) * 3600;
    const key = `${flow.mint}:${hourTs}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(flow);
  }

  console.log(`Grouped into ${groups.size} unique (mint, hour) pairs`);

  // Collect unique mints
  const uniqueMints = new Set(allFlows.map(f => f.mint));
  console.log(`Unique mints: ${[...uniqueMints].join(', ')}`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let groupIdx = 0;

  for (const [key, flows] of groups) {
    groupIdx++;
    const [mint] = key.split(':');
    const timestamp = Math.floor(flows[0].transaction.timestamp.getTime() / 1000);

    // Skip non-Solana mints and pseudo-mints
    if (mint.startsWith('exchange:') || mint.startsWith('fiat:') ||
        mint.startsWith('native') || mint.startsWith('binance:') ||
        mint.startsWith('0x')) {
      skipped += flows.length;
      continue;
    }

    const price = await getCachedPrice(mint, timestamp);

    if (price === null) {
      failed += flows.length;
      continue;
    }

    for (const flow of flows) {
      const amount = Number(flow.amount);
      const valueUsd = new Prisma.Decimal((amount * price).toFixed(8));

      await prisma.transactionFlow.update({
        where: { id: flow.id },
        data: {
          valueUsd,
          priceAtExecution: new Prisma.Decimal(price.toFixed(8)),
        },
      });
      updated++;
    }

    if (groupIdx % 50 === 0) {
      console.log(`  Progress: ${groupIdx}/${groups.size} groups, ${updated} flows updated`);
    }
  }

  console.log(`\nPrice backfill: ${updated} updated, ${skipped} skipped (non-Solana), ${failed} failed`);

  // Now update totalValueUsd on transactions that got flow prices
  console.log('\nUpdating transaction totalValueUsd from enriched flows...');

  const txsMissingValue = await prisma.transaction.findMany({
    where: {
      OR: [
        { totalValueUsd: null },
        { totalValueUsd: new Prisma.Decimal(0) },
      ],
    },
    include: { flows: true },
  });

  let txUpdated = 0;
  for (const tx of txsMissingValue) {
    const nonFeeFlows = tx.flows.filter(f => !f.isFee);
    const withValue = nonFeeFlows.filter(f => f.valueUsd !== null);
    if (withValue.length === 0) continue;

    const total = withValue.reduce(
      (sum, f) => sum.add(f.valueUsd!),
      new Prisma.Decimal(0),
    );

    if (total.gt(0)) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { totalValueUsd: total },
      });
      txUpdated++;
    }
  }

  console.log(`Updated totalValueUsd on ${txUpdated} transactions`);

  // Final stats
  const stats = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN "totalValueUsd" IS NOT NULL AND "totalValueUsd" > 0 THEN 1 END) as with_usd,
      ROUND(COUNT(CASE WHEN "totalValueUsd" IS NOT NULL AND "totalValueUsd" > 0 THEN 1 END) * 100.0 / COUNT(*), 1) as pct
    FROM transactions
  `;
  const flowStats = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN "valueUsd" IS NOT NULL THEN 1 END) as with_usd,
      COUNT(CASE WHEN "priceAtExecution" IS NOT NULL THEN 1 END) as with_price,
      COUNT(CASE WHEN mint LIKE 'exchange:%' THEN 1 END) as pseudo_mints
    FROM transaction_flows
  `;

  console.log('\nFinal transaction stats:', stats[0]);
  console.log('Final flow stats:', flowStats[0]);
}

main()
  .catch((e) => {
    console.error('Price backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
