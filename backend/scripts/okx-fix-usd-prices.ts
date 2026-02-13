/**
 * OKX Fix USD Prices — Fills in null valueUsd on convert flows.
 *
 * Uses fillIdxPx from raw bill data (USD index price of the asset)
 * to compute USD value for non-stablecoin converts (ETH→BRL, BNB→BRL).
 *
 * Usage:
 *   cd auditswarm/backend
 *   NODE_PATH=libs/database/node_modules npx tsx scripts/okx-fix-usd-prices.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('='.repeat(60));
  console.log('  OKX Fix USD Prices');
  console.log('='.repeat(60));

  // Find all OKX converts missing USD value
  const txs = await prisma.transaction.findMany({
    where: { type: 'EXCHANGE_CONVERT', exchangeName: 'okx', totalValueUsd: null },
    include: { flows: true },
  });

  console.log(`\n  Converts with null totalValueUsd: ${txs.length}`);

  if (txs.length === 0) {
    console.log('  Nothing to fix');
    await prisma.$disconnect();
    return;
  }

  let fixed = 0;

  for (const tx of txs) {
    const raw = tx.rawData as any;
    const expense = raw?.expense;
    const income = raw?.income;

    // fillIdxPx = USD index price of the crypto asset at time of convert
    const idxPxStr = expense?.fillIdxPx || income?.fillIdxPx || '0';
    const idxPx = parseFloat(idxPxStr);

    // Find the OUT flow (crypto sold)
    const outFlow = tx.flows.find(f => f.direction === 'OUT' && f.isFee === false);
    if (!outFlow) {
      console.log(`  SKIP: ${tx.id} — no OUT flow found`);
      continue;
    }

    if (!idxPx || idxPx <= 0) {
      console.log(`  SKIP: ${tx.id} — no fillIdxPx in raw data (${idxPxStr})`);
      continue;
    }

    // USD value = amount of crypto * USD price
    const amount = Number(outFlow.amount);
    const usdValue = amount * idxPx;

    console.log(`  ${tx.timestamp.toISOString().slice(0, 10)} ${outFlow.symbol} ${amount} × $${idxPx} = $${usdValue.toFixed(2)}`);

    // Update transaction
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { totalValueUsd: new Prisma.Decimal(usdValue.toFixed(8)) },
    });

    // Update OUT flow
    await prisma.transactionFlow.update({
      where: { id: outFlow.id },
      data: { valueUsd: new Prisma.Decimal(usdValue.toFixed(8)) },
    });

    // Update IN flow (BRL side) with same USD value
    const inFlow = tx.flows.find(f => f.direction === 'IN' && f.isFee === false);
    if (inFlow) {
      await prisma.transactionFlow.update({
        where: { id: inFlow.id },
        data: { valueUsd: new Prisma.Decimal(usdValue.toFixed(8)) },
      });
    }

    fixed++;
  }

  console.log(`\n  Fixed: ${fixed}/${txs.length}`);

  // Verify — all converts should now have USD values
  const remaining = await prisma.transaction.count({
    where: { type: 'EXCHANGE_CONVERT', exchangeName: 'okx', totalValueUsd: null },
  });
  console.log(`  Remaining null: ${remaining}`);

  // Show final totals
  const totals = await prisma.$queryRaw<{ count: bigint; total_usd: string }[]>`
    SELECT COUNT(*)::bigint as count, SUM("totalValueUsd")::text as total_usd
    FROM transactions
    WHERE type = 'EXCHANGE_CONVERT' AND "exchangeName" = 'okx'
  `;
  if (totals[0]) {
    console.log(`  Total OKX converts: ${Number(totals[0].count)}, USD volume: $${parseFloat(totals[0].total_usd).toFixed(2)}`);
  }

  // Also show all converts with their USD values
  console.log('\n  All OKX converts:');
  const allTxs = await prisma.transaction.findMany({
    where: { type: 'EXCHANGE_CONVERT', exchangeName: 'okx' },
    include: { flows: { where: { direction: 'OUT', isFee: false } } },
    orderBy: { timestamp: 'asc' },
  });
  for (const tx of allTxs) {
    const f = tx.flows[0];
    console.log(`    ${tx.timestamp.toISOString().slice(0, 10)} ${f?.symbol?.padEnd(6) ?? '?'} ${Number(f?.amount ?? 0).toFixed(4).padStart(12)} → $${Number(tx.totalValueUsd ?? 0).toFixed(2).padStart(10)}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
