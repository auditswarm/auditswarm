/**
 * Backfill USD prices for ALL flows using:
 * 1. Binance public klines API (no auth) for exchange tokens (BNB, ETH, BTC, etc.)
 * 2. Birdeye multi-chain API for Solana SPL tokens (when API key is valid)
 *
 * Usage: cd auditswarm/backend && NODE_PATH=libs/database/node_modules npx tsx scripts/backfill-prices.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import https from 'https';

const prisma = new PrismaClient();

const BIRDEYE_BASE = 'https://public-api.birdeye.so';
const BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY ?? 'd9ebeae068da418b8d27c35a76729096';
const BINANCE_BASE = 'https://api.binance.com';

/**
 * Maps exchange pseudo-mints to Binance trading pair symbols.
 * Binance klines endpoint: GET /api/v3/klines?symbol=BNBUSDT&interval=1m&...
 */
const BINANCE_PAIR_MAP: Record<string, string> = {
  'exchange:bnb':   'BNBUSDT',
  'exchange:eth':   'ETHUSDT',
  'exchange:btc':   'BTCUSDT',
  'exchange:sol':   'SOLUSDT',
  'exchange:ada':   'ADAUSDT',
  'exchange:dot':   'DOTUSDT',
  'exchange:xrp':   'XRPUSDT',
  'exchange:doge':  'DOGEUSDT',
  'exchange:avax':  'AVAXUSDT',
  'exchange:matic': 'MATICUSDT',
  'exchange:pol':   'MATICUSDT',
  'exchange:link':  'LINKUSDT',
  'exchange:shib':  'SHIBUSDT',
  'exchange:atom':  'ATOMUSDT',
  'exchange:near':  'NEARUSDT',
  'exchange:ftm':   'FTMUSDT',
  'exchange:arb':   'ARBUSDT',
  'exchange:apt':   'APTUSDT',
  'exchange:sui':   'SUIUSDT',
  'exchange:op':    'OPUSDT',
  'exchange:ltc':   'LTCUSDT',
  'exchange:trx':   'TRXUSDT',
  'exchange:cake':  'CAKEUSDT',
  'exchange:wbtc':  'WBTCUSDT',
  'exchange:weth':  'WETHUSDT',
  // Binance internal
  'binance:BNB':    'BNBUSDT',
  'binance:BETH':   'ETHUSDT',
  'binance:BNSOL':  'SOLUSDT',
};

/**
 * Maps Solana mints to Binance trading pairs (for when Birdeye is unavailable).
 */
const SOLANA_MINT_BINANCE: Record<string, string> = {
  'So11111111111111111111111111111111111111112':  'SOLUSDT',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': '__STABLE__', // USDC = $1
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB':  '__STABLE__', // USDT = $1
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONKUSDT',
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN':   'JUPUSDT',
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R':  'RAYUSDT',
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3':  'PYTHUSDT',
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm':  'WIFUSDT',
  'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof':   'RENDERUSDT',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So':   'MSOLUSDT',
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn':  'JITOUSDT',
};

// Rate limiting
let binanceTokens = 10;
let binanceLastRefill = Date.now();

async function acquireBinanceToken(): Promise<void> {
  const now = Date.now();
  const elapsed = now - binanceLastRefill;
  if (elapsed >= 1000) {
    binanceTokens = 10; // Binance: 1200 weight/min ≈ 10 klines/sec safely
    binanceLastRefill = now;
  }
  if (binanceTokens <= 0) {
    await new Promise(resolve => setTimeout(resolve, 1100 - elapsed));
    binanceTokens = 10;
    binanceLastRefill = Date.now();
  }
  binanceTokens--;
}

function fetchJson(url: string, headers: Record<string, string> = {}): Promise<any> {
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

/**
 * Get historical price from Binance public klines API.
 * No authentication needed. Returns close price at the given timestamp.
 */
async function getBinancePrice(pair: string, timestampSec: number): Promise<number | null> {
  await acquireBinanceToken();

  try {
    const startMs = timestampSec * 1000;
    const endMs = startMs + 60000; // 1 minute window
    const url = `${BINANCE_BASE}/api/v3/klines?symbol=${pair}&interval=1m&startTime=${startMs}&endTime=${endMs}&limit=1`;
    const data = await fetchJson(url);

    if (Array.isArray(data) && data.length > 0) {
      return parseFloat(data[0][4]); // [4] = close price
    }

    // Fallback: try 1h candle
    const hourStart = Math.floor(timestampSec / 3600) * 3600 * 1000;
    const url2 = `${BINANCE_BASE}/api/v3/klines?symbol=${pair}&interval=1h&startTime=${hourStart}&endTime=${hourStart + 3600000}&limit=1`;
    const data2 = await fetchJson(url2);

    if (Array.isArray(data2) && data2.length > 0) {
      return parseFloat(data2[0][4]);
    }

    return null;
  } catch (error: any) {
    console.error(`  Binance price failed for ${pair} at ${timestampSec}: ${error.message}`);
    return null;
  }
}

/**
 * Get historical price from Birdeye API (Solana tokens).
 */
async function getBirdeyePrice(address: string, chain: string, timestampSec: number): Promise<number | null> {
  try {
    const url = `${BIRDEYE_BASE}/defi/history_price?address=${address}&address_type=token&type=1m&time_from=${timestampSec}&time_to=${timestampSec + 60}`;
    const response = await fetchJson(url, {
      'X-API-KEY': BIRDEYE_API_KEY,
      'x-chain': chain,
      'accept': 'application/json',
    });

    if (response?.success === false) return null;

    const items = response?.data?.items ?? [];
    if (items.length > 0) return items[0].value;

    // Try 5m window
    const url2 = `${BIRDEYE_BASE}/defi/history_price?address=${address}&address_type=token&type=5m&time_from=${timestampSec - 300}&time_to=${timestampSec + 300}`;
    const response2 = await fetchJson(url2, {
      'X-API-KEY': BIRDEYE_API_KEY,
      'x-chain': chain,
      'accept': 'application/json',
    });

    if (response2?.success === false) return null;
    const items2 = response2?.data?.items ?? [];
    if (items2.length > 0) return items2[0].value;

    return null;
  } catch {
    return null;
  }
}

// Cache: mint:hourTs → price
const priceCache = new Map<string, number | null>();

/**
 * Get price for a mint at a given timestamp. Resolution order:
 * 1. Stablecoins → $1.00
 * 2. exchange:* / binance:* → Binance klines
 * 3. Solana mints with known Binance pair → Binance klines
 * 4. Solana mints → Birdeye (if API key valid)
 */
async function getCachedPrice(mint: string, timestampSec: number): Promise<number | null> {
  const hourTs = Math.floor(timestampSec / 3600) * 3600;
  const key = `${mint}:${hourTs}`;

  if (priceCache.has(key)) return priceCache.get(key)!;

  let price: number | null = null;

  // 1. Check Binance pair map for exchange mints
  const binancePair = BINANCE_PAIR_MAP[mint] ?? BINANCE_PAIR_MAP[mint.toLowerCase()];
  if (binancePair) {
    price = await getBinancePrice(binancePair, hourTs);
  }

  // 2. Check Solana mint → Binance pair map
  if (price === null && SOLANA_MINT_BINANCE[mint]) {
    const pair = SOLANA_MINT_BINANCE[mint];
    if (pair === '__STABLE__') {
      price = 1.0;
    } else {
      price = await getBinancePrice(pair, hourTs);
    }
  }

  // 3. Try Birdeye for unknown Solana mints (base58, not exchange:*)
  if (price === null && !mint.startsWith('exchange:') && !mint.startsWith('binance:') &&
      !mint.startsWith('fiat:') && !mint.startsWith('0x') && mint !== 'native') {
    price = await getBirdeyePrice(mint, 'solana', hourTs);
  }

  priceCache.set(key, price);
  return price;
}

function isResolvable(mint: string): boolean {
  if (BINANCE_PAIR_MAP[mint] || BINANCE_PAIR_MAP[mint.toLowerCase()]) return true;
  if (SOLANA_MINT_BINANCE[mint]) return true;
  if (mint.startsWith('fiat:') || mint === 'native') return false;
  if (mint.startsWith('exchange:') || mint.startsWith('binance:') || mint.startsWith('0x')) return false;
  return true; // assume Solana, try Birdeye
}

async function main() {
  console.log('Starting multi-source price backfill...\n');
  console.log('Sources: Binance public klines (primary), Birdeye (fallback for Solana SPL)\n');

  // Get all flows missing USD values
  const flowsMissingPrice = await prisma.transactionFlow.findMany({
    where: { valueUsd: null },
    include: {
      transaction: { select: { timestamp: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${flowsMissingPrice.length} flows without USD values`);

  // Group by mint + hour to minimize API calls
  const groups = new Map<string, typeof flowsMissingPrice>();
  for (const flow of flowsMissingPrice) {
    const hourTs = Math.floor(flow.transaction.timestamp.getTime() / 3600000) * 3600;
    const key = `${flow.mint}:${hourTs}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(flow);
  }

  console.log(`Grouped into ${groups.size} unique (mint, hour) pairs`);

  // Show unique mints and their resolution
  const uniqueMints = new Set(flowsMissingPrice.map(f => f.mint));
  for (const mint of uniqueMints) {
    const pair = BINANCE_PAIR_MAP[mint] ?? BINANCE_PAIR_MAP[mint.toLowerCase()];
    const solPair = SOLANA_MINT_BINANCE[mint];
    if (pair) {
      console.log(`  ${mint} → Binance ${pair}`);
    } else if (solPair) {
      console.log(`  ${mint.slice(0, 12)}... → ${solPair === '__STABLE__' ? 'Stablecoin $1' : `Binance ${solPair}`}`);
    } else if (isResolvable(mint)) {
      console.log(`  ${mint.slice(0, 12)}... → Birdeye (Solana)`);
    } else {
      console.log(`  ${mint} → SKIP (unresolvable)`);
    }
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let groupIdx = 0;

  for (const [key, flows] of groups) {
    groupIdx++;
    const mint = key.substring(0, key.lastIndexOf(':'));
    const timestamp = Math.floor(flows[0].transaction.timestamp.getTime() / 1000);

    if (!isResolvable(mint)) {
      skipped += flows.length;
      continue;
    }

    const price = await getCachedPrice(mint, timestamp);

    if (price === null) {
      failed += flows.length;
      if (failed <= 10) {
        console.log(`  FAILED: ${mint} at ${new Date(timestamp * 1000).toISOString()}`);
      }
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

    if (groupIdx % 20 === 0) {
      console.log(`  Progress: ${groupIdx}/${groups.size} groups, ${updated} updated, ${failed} failed`);
    }
  }

  console.log(`\nPrice backfill: ${updated} updated, ${skipped} skipped (unresolvable), ${failed} failed`);

  // Update totalValueUsd on transactions that got flow prices
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
      COUNT(*)::int as total,
      COUNT(CASE WHEN "totalValueUsd" IS NOT NULL AND "totalValueUsd" > 0 THEN 1 END)::int as with_usd,
      ROUND(COUNT(CASE WHEN "totalValueUsd" IS NOT NULL AND "totalValueUsd" > 0 THEN 1 END) * 100.0 / COUNT(*), 1) as pct
    FROM transactions
  `;
  const flowStats = await prisma.$queryRaw<any[]>`
    SELECT
      COUNT(*)::int as total,
      COUNT(CASE WHEN "valueUsd" IS NOT NULL THEN 1 END)::int as with_usd,
      COUNT(CASE WHEN "valueUsd" IS NULL THEN 1 END)::int as without_usd,
      COUNT(CASE WHEN "priceAtExecution" IS NOT NULL THEN 1 END)::int as with_price
    FROM transaction_flows
  `;

  console.log('\nFinal transaction stats:', JSON.stringify(stats[0]));
  console.log('Final flow stats:', JSON.stringify(flowStats[0]));
}

main()
  .catch((e) => {
    console.error('Price backfill failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
