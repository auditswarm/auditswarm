/**
 * Quick price fix for newly synced trades missing USD values.
 * Usage: cd auditswarm/backend && NODE_PATH=libs/database/node_modules npx tsx scripts/fix-new-trades.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import https from 'https';

const prisma = new PrismaClient();
const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY ?? 'd9ebeae068da418b8d27c35a76729096';

function fetchJson(url: string, headers: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let d = '';
      res.on('data', (c: string) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('bad json')); } });
    }).on('error', reject);
  });
}

async function main() {
  // Find exchange flows without USD values
  const newFlows = await prisma.transactionFlow.findMany({
    where: { exchangeConnectionId: { not: null }, valueUsd: null },
    include: { transaction: { select: { timestamp: true } } },
  });
  console.log('Flows missing USD:', newFlows.length);

  let updated = 0;
  for (const f of newFlows) {
    const skip = f.mint.startsWith('exchange:') || f.mint.startsWith('fiat:') ||
                 f.mint.startsWith('0x') || f.mint === 'native' || f.mint.startsWith('binance:');
    if (skip) continue;

    const ts = Math.floor(f.transaction.timestamp.getTime() / 1000);
    const hourTs = Math.floor(ts / 3600) * 3600;
    const url = `${`https://public-api.birdeye.so`}/defi/history_price?address=${f.mint}&address_type=token&type=5m&time_from=${hourTs - 300}&time_to=${hourTs + 300}`;

    try {
      const resp = await fetchJson(url, { 'X-API-KEY': BIRDEYE_KEY, accept: 'application/json' });
      const items = resp?.data?.items ?? [];
      if (items.length > 0) {
        const price = items[0].value;
        const amount = Number(f.amount);
        await prisma.transactionFlow.update({
          where: { id: f.id },
          data: {
            valueUsd: new Prisma.Decimal((amount * price).toFixed(8)),
            priceAtExecution: new Prisma.Decimal(price.toFixed(8)),
          },
        });
        updated++;
      }
    } catch { /* skip */ }
  }

  console.log(`Flows priced: ${updated}`);

  // Update transaction totalValueUsd from enriched flows
  const txs = await prisma.transaction.findMany({
    where: {
      type: 'EXCHANGE_TRADE',
      OR: [{ totalValueUsd: null }, { totalValueUsd: new Prisma.Decimal(0) }],
    },
    include: { flows: true },
  });

  let txUpdated = 0;
  for (const tx of txs) {
    const nonFee = tx.flows.filter(f => f.isFee === false);
    const withVal = nonFee.filter(f => f.valueUsd !== null);
    if (withVal.length === 0) continue;
    const total = withVal.reduce((s, f) => s.add(f.valueUsd as Prisma.Decimal), new Prisma.Decimal(0));
    if (total.gt(0)) {
      await prisma.transaction.update({ where: { id: tx.id }, data: { totalValueUsd: total } });
      txUpdated++;
    }
  }

  console.log(`Transactions updated: ${txUpdated}`);

  // Show all trades
  const q = await prisma.$queryRaw<any[]>`
    SELECT t."externalId", t.type, t."totalValueUsd"::text as usd,
      t.timestamp::text as ts,
      jsonb_array_length(t.transfers::jsonb) as flows
    FROM transactions t
    WHERE t.type = 'EXCHANGE_TRADE'
    ORDER BY t.timestamp
  `;
  console.log('\nAll trades:');
  console.table(q);
}

main()
  .catch(e => { console.error('Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
