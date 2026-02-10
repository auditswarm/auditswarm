/**
 * Backfill USD prices for exchange transaction flows that are missing priceAtExecution.
 * Uses Binance public klines API (no auth needed) for historical daily prices.
 *
 * Usage:
 *   cd auditswarm/backend
 *   NODE_PATH=libs/database/node_modules npx tsx scripts/backfill-exchange-prices.ts
 *
 * Flags:
 *   --dry-run    Show what would be updated without writing
 *   --connection <id>  Filter to a specific exchange connection
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const CONNECTION_ID = process.argv.includes('--connection')
  ? process.argv[process.argv.indexOf('--connection') + 1]
  : null;
const DRY_RUN = process.argv.includes('--dry-run');

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ========== Price cache ==========
// Keyed by "SYMBOL:DATE" (e.g. "SOL:2025-09-08"), value is USD price
const priceCache = new Map<string, number | null>();

function dateKey(ts: Date): string {
  return ts.toISOString().slice(0, 10);
}

/**
 * Fetch daily close price from Binance public klines API.
 * Tries SYMBOL+USDT first, then SYMBOL+USDC, then SYMBOL+BUSD.
 */
async function fetchBinancePrice(symbol: string, date: Date): Promise<number | null> {
  const key = `${symbol}:${dateKey(date)}`;
  if (priceCache.has(key)) return priceCache.get(key)!;

  // Stablecoins
  const stablecoins = new Set([
    'USDT', 'USDC', 'BUSD', 'FDUSD', 'USD1', 'DAI', 'TUSD', 'USDP',
    'GUSD', 'FRAX', 'PYUSD', 'USDD', 'CUSD', 'SUSD', 'LUSD',
  ]);
  if (stablecoins.has(symbol.toUpperCase()) || symbol.toUpperCase() === 'USD') {
    priceCache.set(key, 1.0);
    return 1.0;
  }

  // Try different quote currencies
  const quotePairs = [
    { quote: 'USDT', multiplier: 1.0 },
    { quote: 'USDC', multiplier: 1.0 },
    { quote: 'BUSD', multiplier: 1.0 },
    { quote: 'FDUSD', multiplier: 1.0 },
  ];

  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

  for (const { quote, multiplier } of quotePairs) {
    const pair = `${symbol.toUpperCase()}${quote}`;
    const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1d&startTime=${startOfDay.getTime()}&endTime=${endOfDay.getTime()}&limit=1`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;

      const data = await resp.json();
      if (Array.isArray(data) && data.length > 0) {
        // kline format: [openTime, open, high, low, close, volume, ...]
        const closePrice = parseFloat(data[0][4]) * multiplier;
        if (closePrice > 0) {
          priceCache.set(key, closePrice);
          return closePrice;
        }
      }
    } catch {
      // Try next pair
    }

    await delay(50); // Respect rate limits
  }

  priceCache.set(key, null);
  return null;
}

/**
 * For BRL amounts, fetch BRL/USD rate via USDTBRL pair (inverse).
 */
async function fetchBrlToUsd(date: Date): Promise<number | null> {
  const key = `BRL_USD:${dateKey(date)}`;
  if (priceCache.has(key)) return priceCache.get(key)!;

  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

  // USDTBRL gives us how many BRL per 1 USDT
  const url = `https://api.binance.com/api/v3/klines?symbol=USDTBRL&interval=1d&startTime=${startOfDay.getTime()}&endTime=${endOfDay.getTime()}&limit=1`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      priceCache.set(key, null);
      return null;
    }

    const data = await resp.json();
    if (Array.isArray(data) && data.length > 0) {
      const brlPerUsd = parseFloat(data[0][4]); // close price of USDTBRL
      if (brlPerUsd > 0) {
        const rate = 1 / brlPerUsd; // 1 BRL = X USD
        priceCache.set(key, rate);
        return rate;
      }
    }
  } catch {
    // ignore
  }

  priceCache.set(key, null);
  return null;
}

/**
 * Extract price from convert rawData.
 * If one side is USD-denominated, use that as the price reference.
 */
function extractConvertPrice(
  symbol: string,
  rawData: any,
): number | null {
  if (!rawData) return null;

  const usdStables = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'USD1', 'DAI']);
  const fromAsset = rawData.fromAsset?.toUpperCase();
  const toAsset = rawData.toAsset?.toUpperCase();
  const fromAmount = parseFloat(rawData.fromAmount);
  const toAmount = parseFloat(rawData.toAmount);

  if (isNaN(fromAmount) || isNaN(toAmount) || fromAmount === 0 || toAmount === 0) return null;

  const upper = symbol.toUpperCase();

  if (upper === fromAsset && usdStables.has(toAsset)) {
    // e.g. SOL→USDC: price per SOL = toAmount / fromAmount
    return toAmount / fromAmount;
  }

  if (upper === toAsset && usdStables.has(fromAsset)) {
    // e.g. USDT→SOL: price per SOL = fromAmount / toAmount
    return fromAmount / toAmount;
  }

  if (upper === fromAsset && usdStables.has(fromAsset)) {
    return 1.0; // This flow IS the stablecoin side
  }

  if (upper === toAsset && usdStables.has(toAsset)) {
    return 1.0;
  }

  return null;
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Exchange Price Backfill${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`${'='.repeat(60)}\n`);

  // Get all exchange flows missing price data
  const whereClause: any = {
    priceAtExecution: null,
    isFee: false,
    exchangeConnectionId: { not: null },
  };
  if (CONNECTION_ID) {
    whereClause.exchangeConnectionId = CONNECTION_ID;
  }

  const unpricedFlows = await prisma.transactionFlow.findMany({
    where: whereClause,
    include: {
      transaction: {
        select: {
          id: true,
          type: true,
          timestamp: true,
          rawData: true,
          totalValueUsd: true,
        },
      },
    },
    orderBy: { transaction: { timestamp: 'asc' } },
  });

  console.log(`  Unpriced flows: ${unpricedFlows.length}`);

  // Group by symbol to show stats
  const symbolStats = new Map<string, number>();
  for (const f of unpricedFlows) {
    const sym = f.symbol || f.mint;
    symbolStats.set(sym, (symbolStats.get(sym) || 0) + 1);
  }
  console.log(`  By symbol:`);
  for (const [sym, count] of [...symbolStats.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${sym}: ${count}`);
  }

  let updated = 0;
  let failed = 0;
  let txUpdated = 0;
  const fiatCurrencies = new Set([
    'BRL', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'TRY', 'RUB', 'NGN',
    'ARS', 'COP', 'KES', 'ZAR', 'INR', 'IDR', 'PHP', 'VND', 'THB', 'MYR',
  ]);

  // Process flows
  for (let i = 0; i < unpricedFlows.length; i++) {
    const flow = unpricedFlows[i];
    const symbol = (flow.symbol || flow.mint).toUpperCase();
    const tx = flow.transaction;
    const timestamp = tx.timestamp;

    let priceUsd: number | null = null;

    // 1. Try extracting from convert rawData
    if (tx.type === 'EXCHANGE_CONVERT') {
      priceUsd = extractConvertPrice(symbol, tx.rawData);
    }

    // 2. Try Binance public API
    if (priceUsd == null) {
      if (fiatCurrencies.has(symbol)) {
        // For BRL, need special handling
        if (symbol === 'BRL') {
          priceUsd = await fetchBrlToUsd(timestamp);
        }
        // Other fiats: skip for now (not critical)
      } else {
        priceUsd = await fetchBinancePrice(symbol, timestamp);
      }
    }

    if (priceUsd != null && priceUsd > 0) {
      const amount = flow.amount.toNumber();
      const valueUsd = new Prisma.Decimal((amount * priceUsd).toFixed(8));
      const priceDecimal = new Prisma.Decimal(priceUsd.toFixed(8));

      if (!DRY_RUN) {
        await prisma.transactionFlow.update({
          where: { id: flow.id },
          data: {
            priceAtExecution: priceDecimal,
            valueUsd,
          },
        });

        // Also update parent transaction totalValueUsd if null
        if (tx.totalValueUsd == null || Number(tx.totalValueUsd) === 0) {
          // Sum all flows for this transaction to get total value
          const allFlows = await prisma.transactionFlow.findMany({
            where: { transactionId: tx.id, isFee: false },
            select: { valueUsd: true, direction: true },
          });
          const totalValue = allFlows.reduce((sum, f) => {
            if (f.valueUsd == null) return sum;
            // Use the larger side (IN or OUT) as total value
            return Math.max(sum, Number(f.valueUsd));
          }, 0);
          if (totalValue > 0) {
            await prisma.transaction.update({
              where: { id: tx.id },
              data: { totalValueUsd: new Prisma.Decimal(totalValue.toFixed(8)) },
            });
            txUpdated++;
          }
        }
      }

      updated++;
    } else {
      failed++;
    }

    // Progress reporting
    if ((i + 1) % 500 === 0 || i === unpricedFlows.length - 1) {
      console.log(`  Progress: ${i + 1}/${unpricedFlows.length} (${updated} priced, ${failed} failed)`);
    }

    // Rate limiting for API calls
    if (i % 20 === 0) await delay(100);
  }

  console.log(`\n--- RESULTS ---`);
  console.log(`  Flows priced: ${updated}`);
  console.log(`  Flows failed: ${failed}`);
  console.log(`  Transactions updated: ${txUpdated}`);

  // Final coverage check
  const coverageAfter = await prisma.$queryRaw<{ total: bigint; has_usd: bigint }[]>`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(CASE WHEN tf."priceAtExecution" IS NOT NULL THEN 1 END)::bigint AS has_usd
    FROM transaction_flows tf
    WHERE tf."exchangeConnectionId" IS NOT NULL
      AND tf."isFee" = false
      ${CONNECTION_ID ? Prisma.sql`AND tf."exchangeConnectionId" = ${CONNECTION_ID}` : Prisma.empty}
  `;

  if (coverageAfter.length > 0) {
    const total = Number(coverageAfter[0].total);
    const hasUsd = Number(coverageAfter[0].has_usd);
    console.log(`\n  Price coverage: ${hasUsd}/${total} (${(hasUsd / total * 100).toFixed(1)}%)`);
  }

  // Also check transaction-level coverage
  const txCoverage = await prisma.$queryRaw<{ total: bigint; has_usd: bigint }[]>`
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(CASE WHEN t."totalValueUsd" IS NOT NULL AND t."totalValueUsd" > 0 THEN 1 END)::bigint AS has_usd
    FROM transactions t
    WHERE t."exchangeConnectionId" IS NOT NULL
      ${CONNECTION_ID ? Prisma.sql`AND t."exchangeConnectionId" = ${CONNECTION_ID}` : Prisma.empty}
  `;

  if (txCoverage.length > 0) {
    const total = Number(txCoverage[0].total);
    const hasUsd = Number(txCoverage[0].has_usd);
    console.log(`  TX USD coverage: ${hasUsd}/${total} (${(hasUsd / total * 100).toFixed(1)}%)`);
  }

  await prisma.$disconnect();
  console.log('\nDone!');
}

main().catch(e => { console.error(e); process.exit(1); });
