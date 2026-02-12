/**
 * Direct Bee Test Script
 * Bypasses API/queue/LangGraph to test the bee calculation directly.
 * Loads TransactionFlow data from DB and runs the BR bee.
 *
 * Usage: NODE_PATH=libs/database/node_modules npx tsx scripts/test-bee-direct.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Inline the bee types & logic so we don't need NestJS bootstrap ───

interface BeeOptions {
  costBasisMethod: 'FIFO' | 'LIFO' | 'HIFO' | 'SPECIFIC_ID' | 'AVERAGE';
  includeStaking: boolean;
  includeAirdrops: boolean;
  includeNFTs: boolean;
  includeDeFi: boolean;
  includeFees: boolean;
  currency: string;
}

interface TransferLike {
  mint: string;
  symbol: string;
  decimals: number;
  amount: number;
  rawAmount: string;
  direction: 'IN' | 'OUT';
  valueUsd: number;
  isFee: boolean;
  priceAtExecution?: number;
}

interface TxLike {
  id: string;
  walletId?: string;
  signature?: string;
  type: string;
  status: string;
  timestamp: Date;
  slot?: number;
  blockTime?: number;
  fee?: bigint;
  feePayer?: string;
  transfers: TransferLike[];
  totalValueUsd?: number;
  source: string;
  rawData: Record<string, unknown>;
}

interface CostBasisLot {
  id: string;
  transactionId: string;
  asset: string;
  amount: number;
  costBasis: number;
  dateAcquired: Date;
  remaining: number;
}

// ─── Load transactions exactly as audit.processor.ts does ───

async function loadTransactions(walletIds: string[], taxYear: number): Promise<TxLike[]> {
  const startDate = new Date(taxYear, 0, 1);
  const endDate = new Date(taxYear, 11, 31, 23, 59, 59);

  // Load period transactions + ALL pre-period transactions for cost basis lots
  const [periodTxs, prePeriodTxs] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        walletId: { in: walletIds },
        timestamp: { gte: startDate, lte: endDate },
      },
      orderBy: { timestamp: 'asc' },
      take: 50000,
    }),
    prisma.transaction.findMany({
      where: {
        walletId: { in: walletIds },
        timestamp: { lt: startDate },
      },
      orderBy: { timestamp: 'asc' },
      take: 50000,
    }),
  ]);

  // Also load exchange transactions (no walletId)
  const exchangeTxs = await prisma.transaction.findMany({
    where: {
      source: 'EXCHANGE',
      timestamp: { gte: new Date(taxYear - 3, 0, 1), lte: endDate },
    },
    orderBy: { timestamp: 'asc' },
    take: 50000,
  });

  const allDbTxs = [...prePeriodTxs, ...periodTxs, ...exchangeTxs];

  // Deduplicate by id
  const seen = new Set<string>();
  const uniqueTxs = allDbTxs.filter(tx => {
    if (seen.has(tx.id)) return false;
    seen.add(tx.id);
    return true;
  });

  const txIds = uniqueTxs.map(tx => tx.id);

  // Load real TransactionFlow records
  const flows = await prisma.transactionFlow.findMany({
    where: { transactionId: { in: txIds } },
  });

  // Group flows by transactionId
  const flowsByTx = new Map<string, typeof flows>();
  for (const flow of flows) {
    const arr = flowsByTx.get(flow.transactionId) || [];
    arr.push(flow);
    flowsByTx.set(flow.transactionId, arr);
  }

  console.log(`Loaded ${periodTxs.length} period + ${prePeriodTxs.length} pre-period + ${exchangeTxs.length} exchange txs`);
  console.log(`Unique: ${uniqueTxs.length} txs, ${flows.length} flows`);

  // Map to TxLike
  return uniqueTxs.map(tx => {
    const txFlows = flowsByTx.get(tx.id) || [];

    const transfers: TransferLike[] = txFlows.map(f => ({
      mint: f.mint,
      symbol: f.symbol || f.mint.slice(0, 4),
      decimals: f.decimals,
      amount: Number(f.amount),
      rawAmount: f.rawAmount,
      direction: f.direction as 'IN' | 'OUT',
      valueUsd: f.valueUsd ? Number(f.valueUsd) : 0,
      isFee: f.isFee || false,
      priceAtExecution: f.priceAtExecution ? Number(f.priceAtExecution) : undefined,
    }));

    return {
      id: tx.id,
      walletId: tx.walletId ?? undefined,
      signature: tx.signature ?? undefined,
      type: tx.type,
      status: tx.status,
      timestamp: tx.timestamp,
      slot: tx.slot ? Number(tx.slot) : undefined,
      blockTime: tx.blockTime ? Number(tx.blockTime) : undefined,
      fee: tx.fee ?? undefined,
      feePayer: tx.feePayer ?? undefined,
      transfers,
      totalValueUsd: tx.totalValueUsd ? Number(tx.totalValueUsd) : undefined,
      source: (tx.source ?? 'ONCHAIN') as string,
      rawData: (tx.rawData as Record<string, unknown>) || {},
    };
  });
}

// ─── Inline bee calculation logic ───

function buildCostBasisLots(transactions: TxLike[]): Map<string, CostBasisLot[]> {
  const lots = new Map<string, CostBasisLot[]>();

  const acquisitionTypes = [
    'BUY', 'TRANSFER_IN', 'SWAP', 'REWARD', 'AIRDROP',
    'EXCHANGE_TRADE', 'EXCHANGE_C2C_TRADE', 'EXCHANGE_FIAT_BUY',
    'EXCHANGE_CONVERT', 'EXCHANGE_DUST_CONVERT',
    'EXCHANGE_INTEREST', 'EXCHANGE_DIVIDEND',
    'EXCHANGE_UNSTAKE', 'MARGIN_BORROW',
  ];
  const acquisitions = transactions.filter(tx => acquisitionTypes.includes(tx.type));

  for (const tx of acquisitions) {
    for (const transfer of tx.transfers) {
      if (transfer.isFee) continue;
      if (transfer.direction === 'IN') {
        const assetLots = lots.get(transfer.mint) || [];
        assetLots.push({
          id: `${tx.id}-${transfer.mint}`,
          transactionId: tx.id,
          asset: transfer.mint,
          amount: transfer.amount,
          costBasis: transfer.valueUsd || 0,
          dateAcquired: tx.timestamp,
          remaining: transfer.amount,
        });
        lots.set(transfer.mint, assetLots);
      }
    }
  }

  return lots;
}

function matchLot(
  lots: Map<string, CostBasisLot[]>,
  asset: string,
  amount: number,
  method: string,
): CostBasisLot | null {
  const assetLots = lots.get(asset);
  if (!assetLots || assetLots.length === 0) return null;

  const sortedLots = [...assetLots].sort((a, b) => {
    switch (method) {
      case 'FIFO':
        return a.dateAcquired.getTime() - b.dateAcquired.getTime();
      case 'LIFO':
        return b.dateAcquired.getTime() - a.dateAcquired.getTime();
      case 'HIFO':
        return (b.costBasis / b.amount) - (a.costBasis / a.amount);
      default:
        return a.dateAcquired.getTime() - b.dateAcquired.getTime();
    }
  });

  for (const lot of sortedLots) {
    if (lot.remaining >= amount) {
      lot.remaining -= amount;
      return {
        ...lot,
        costBasis: (lot.costBasis / lot.amount) * amount,
      };
    }
  }

  return null;
}

// ─── Main ───

async function main() {
  const wallets = await prisma.wallet.findMany({
    select: { id: true, address: true, label: true },
  });

  console.log(`\n=== WALLETS (${wallets.length}) ===`);
  wallets.forEach(w => console.log(`  ${w.id} | ${w.address?.slice(0, 12)}... | ${w.label || 'no label'}`));

  const walletIds = wallets.map(w => w.id);
  const taxYear = 2025;
  const method = 'FIFO';

  console.log(`\n=== LOADING TRANSACTIONS FOR TAX YEAR ${taxYear} ===`);
  const allTxs = await loadTransactions(walletIds, taxYear);

  // Filter for tax year
  const yearStart = new Date(taxYear, 0, 1);
  const yearEnd = new Date(taxYear, 11, 31, 23, 59, 59);
  const periodTxs = allTxs.filter(tx => tx.timestamp >= yearStart && tx.timestamp <= yearEnd);

  console.log(`\nAll transactions: ${allTxs.length}`);
  console.log(`Period transactions (${taxYear}): ${periodTxs.length}`);

  // ─── Analyze transaction types in period ───
  const typeCount = new Map<string, number>();
  for (const tx of periodTxs) {
    typeCount.set(tx.type, (typeCount.get(tx.type) || 0) + 1);
  }
  console.log(`\n=== PERIOD TRANSACTION TYPES ===`);
  for (const [type, count] of [...typeCount.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(25)} ${count}`);
  }

  // ─── Check transfers/flows quality ───
  let txWithFlows = 0;
  let txWithValueUsd = 0;
  let totalFlows = 0;
  let flowsWithValue = 0;

  for (const tx of periodTxs) {
    if (tx.transfers.length > 0) txWithFlows++;
    if (tx.totalValueUsd && tx.totalValueUsd > 0) txWithValueUsd++;
    for (const t of tx.transfers) {
      totalFlows++;
      if (t.valueUsd > 0) flowsWithValue++;
    }
  }

  console.log(`\n=== DATA QUALITY (period) ===`);
  console.log(`  Txs with flows: ${txWithFlows}/${periodTxs.length} (${(txWithFlows / periodTxs.length * 100).toFixed(1)}%)`);
  console.log(`  Txs with totalValueUsd > 0: ${txWithValueUsd}/${periodTxs.length}`);
  console.log(`  Total flows: ${totalFlows}`);
  console.log(`  Flows with valueUsd > 0: ${flowsWithValue}/${totalFlows} (${totalFlows > 0 ? (flowsWithValue / totalFlows * 100).toFixed(1) : 0}%)`);

  // ─── Build cost basis lots from ALL transactions (including pre-period) ───
  console.log(`\n=== BUILDING COST BASIS LOTS ===`);
  const lots = buildCostBasisLots(allTxs);

  let totalLots = 0;
  let totalLotValue = 0;
  const topAssets: { asset: string; count: number; value: number }[] = [];

  for (const [asset, assetLots] of lots) {
    totalLots += assetLots.length;
    const totalValue = assetLots.reduce((s, l) => s + l.costBasis, 0);
    totalLotValue += totalValue;
    topAssets.push({ asset, count: assetLots.length, value: totalValue });
  }

  topAssets.sort((a, b) => b.value - a.value);
  console.log(`  Total lots: ${totalLots} across ${lots.size} assets`);
  console.log(`  Total lot value: $${totalLotValue.toFixed(2)}`);
  console.log(`\n  Top 10 assets by cost basis:`);
  for (const { asset, count, value } of topAssets.slice(0, 10)) {
    console.log(`    ${asset.slice(0, 16).padEnd(16)} | ${count} lots | $${value.toFixed(2)}`);
  }

  // ─── Calculate capital gains ───
  console.log(`\n=== CAPITAL GAINS (${method}) ===`);

  const disposalTypes = [
    'SELL', 'SWAP', 'TRANSFER_OUT',
    'EXCHANGE_TRADE', 'EXCHANGE_C2C_TRADE', 'EXCHANGE_FIAT_SELL',
    'EXCHANGE_DUST_CONVERT', 'EXCHANGE_CONVERT',
    'MARGIN_LIQUIDATION',
  ];
  const disposals = periodTxs.filter(tx => disposalTypes.includes(tx.type));

  let shortTermGains = 0;
  let shortTermLosses = 0;
  let longTermGains = 0;
  let longTermLosses = 0;
  let matchedDisposals = 0;
  let unmatchedDisposals = 0;
  const gainTransactions: any[] = [];

  for (const disposal of disposals) {
    for (const transfer of disposal.transfers) {
      if (transfer.isFee) continue;
      if (transfer.direction === 'OUT' && transfer.valueUsd > 0) {
        const lot = matchLot(lots, transfer.mint, transfer.amount, method);
        if (lot) {
          matchedDisposals++;
          const proceeds = transfer.valueUsd;
          const costBasis = lot.costBasis;
          const gainLoss = proceeds - costBasis;
          const holdingDays = Math.floor(
            (disposal.timestamp.getTime() - lot.dateAcquired.getTime()) / (1000 * 60 * 60 * 24),
          );
          const isLongTerm = holdingDays > 365;

          if (isLongTerm) {
            if (gainLoss > 0) longTermGains += gainLoss;
            else longTermLosses += Math.abs(gainLoss);
          } else {
            if (gainLoss > 0) shortTermGains += gainLoss;
            else shortTermLosses += Math.abs(gainLoss);
          }

          gainTransactions.push({
            asset: transfer.symbol || transfer.mint.slice(0, 8),
            dateAcquired: lot.dateAcquired.toISOString().slice(0, 10),
            dateSold: disposal.timestamp.toISOString().slice(0, 10),
            proceeds: proceeds.toFixed(2),
            costBasis: costBasis.toFixed(2),
            gainLoss: gainLoss.toFixed(2),
            type: isLongTerm ? 'LONG' : 'SHORT',
            holdingDays,
          });
        } else {
          unmatchedDisposals++;
        }
      }
    }
  }

  const netShortTerm = shortTermGains - shortTermLosses;
  const netLongTerm = longTermGains - longTermLosses;
  const totalNet = netShortTerm + netLongTerm;

  console.log(`  Disposals in period: ${disposals.length}`);
  console.log(`  Matched to lots: ${matchedDisposals}`);
  console.log(`  Unmatched (no lot): ${unmatchedDisposals}`);
  console.log(`\n  Short-term gains:  $${shortTermGains.toFixed(2)}`);
  console.log(`  Short-term losses: $${shortTermLosses.toFixed(2)}`);
  console.log(`  Net short-term:    $${netShortTerm.toFixed(2)}`);
  console.log(`\n  Long-term gains:   $${longTermGains.toFixed(2)}`);
  console.log(`  Long-term losses:  $${longTermLosses.toFixed(2)}`);
  console.log(`  Net long-term:     $${netLongTerm.toFixed(2)}`);
  console.log(`\n  TOTAL NET:         $${totalNet.toFixed(2)}`);

  if (gainTransactions.length > 0) {
    console.log(`\n  Top 20 gain/loss transactions:`);
    gainTransactions.sort((a, b) => Math.abs(Number(b.gainLoss)) - Math.abs(Number(a.gainLoss)));
    for (const gt of gainTransactions.slice(0, 20)) {
      console.log(`    ${gt.asset.padEnd(10)} | ${gt.dateSold} | proceeds $${gt.proceeds.padStart(10)} | cost $${gt.costBasis.padStart(10)} | ${gt.type} ${gt.gainLoss.padStart(12)} | ${gt.holdingDays}d`);
    }
  }

  // ─── Calculate income ───
  console.log(`\n=== INCOME ===`);
  let stakingIncome = 0;
  let airdropIncome = 0;
  let otherIncome = 0;

  for (const tx of periodTxs) {
    if (tx.type === 'REWARD' || tx.type === 'EXCHANGE_INTEREST') {
      stakingIncome += Number(tx.totalValueUsd ?? 0);
    } else if (tx.type === 'AIRDROP' || tx.type === 'EXCHANGE_DIVIDEND') {
      airdropIncome += Number(tx.totalValueUsd ?? 0);
    } else if (tx.type === 'MARGIN_INTEREST') {
      otherIncome -= Number(tx.totalValueUsd ?? 0);
    }
  }
  const totalIncome = stakingIncome + airdropIncome + otherIncome;

  console.log(`  Staking/interest: $${stakingIncome.toFixed(2)}`);
  console.log(`  Airdrops/dividends: $${airdropIncome.toFixed(2)}`);
  console.log(`  Other: $${otherIncome.toFixed(2)}`);
  console.log(`  TOTAL INCOME: $${totalIncome.toFixed(2)}`);

  // ─── Calculate holdings ───
  console.log(`\n=== HOLDINGS (all-time) ===`);
  const holdings = new Map<string, { symbol: string; balance: number; costBasis: number }>();

  const transferTypes = new Set(['EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL']);

  for (const tx of allTxs) {
    if (transferTypes.has(tx.type)) continue;
    for (const transfer of tx.transfers) {
      if (transfer.isFee) continue;
      const key = transfer.mint;
      const current = holdings.get(key) || { symbol: transfer.symbol, balance: 0, costBasis: 0 };
      if (transfer.direction === 'IN') {
        current.balance += transfer.amount;
        current.costBasis += transfer.valueUsd || 0;
      } else {
        current.balance -= transfer.amount;
      }
      if (!current.symbol || current.symbol === key.slice(0, 4)) {
        current.symbol = transfer.symbol;
      }
      holdings.set(key, current);
    }
  }

  const positiveHoldings = [...holdings.entries()]
    .filter(([_, h]) => h.balance > 0.0001)
    .sort((a, b) => b[1].costBasis - a[1].costBasis);

  const negativeHoldings = [...holdings.entries()]
    .filter(([_, h]) => h.balance < -0.0001)
    .sort((a, b) => a[1].balance - b[1].balance);

  console.log(`  Positive balances: ${positiveHoldings.length}`);
  for (const [mint, h] of positiveHoldings.slice(0, 15)) {
    console.log(`    ${(h.symbol || mint.slice(0, 8)).padEnd(12)} | balance: ${h.balance.toFixed(6).padStart(18)} | costBasis: $${h.costBasis.toFixed(2)}`);
  }

  if (negativeHoldings.length > 0) {
    console.log(`\n  Negative balances (${negativeHoldings.length}):`);
    for (const [mint, h] of negativeHoldings.slice(0, 10)) {
      console.log(`    ${(h.symbol || mint.slice(0, 8)).padEnd(12)} | balance: ${h.balance.toFixed(6).padStart(18)}`);
    }
  }

  // ─── Summary ───
  console.log(`\n========================================`);
  console.log(`AUDIT RESULT SUMMARY`);
  console.log(`========================================`);
  console.log(`  Jurisdiction: BR`);
  console.log(`  Tax Year: ${taxYear}`);
  console.log(`  Method: ${method}`);
  console.log(`  Total transactions: ${allTxs.length}`);
  console.log(`  Period transactions: ${periodTxs.length}`);
  console.log(`  Net gain/loss: $${totalNet.toFixed(2)}`);
  console.log(`  Total income: $${totalIncome.toFixed(2)}`);

  // BR estimated tax (simplified)
  let estimatedTax = 0;
  if (totalNet > 0) estimatedTax = totalNet * 0.15;
  if (totalIncome > 0) estimatedTax += totalIncome * 0.275;
  console.log(`  Estimated tax: $${estimatedTax.toFixed(2)}`);

  console.log(`\n  Capital gains detail:`);
  console.log(`    Short-term: +$${shortTermGains.toFixed(2)} / -$${shortTermLosses.toFixed(2)}`);
  console.log(`    Long-term:  +$${longTermGains.toFixed(2)} / -$${longTermLosses.toFixed(2)}`);
  console.log(`    Net total:   $${totalNet.toFixed(2)}`);

  if (totalNet === 0 && totalIncome === 0 && positiveHoldings.length === 0) {
    console.log(`\n  ⚠️  ALL ZEROS — Data loading problem persists!`);
    console.log(`     Check: flows loaded? ${totalFlows > 0 ? 'YES' : 'NO'}`);
    console.log(`     Check: flows have valueUsd? ${flowsWithValue > 0 ? 'YES' : 'NO'}`);
    console.log(`     Check: disposals in period? ${disposals.length > 0 ? 'YES' : 'NO'}`);
    console.log(`     Check: lots built? ${totalLots > 0 ? 'YES' : 'NO'}`);
  } else {
    console.log(`\n  ✅  Non-zero results — Bee calculation is working!`);
  }

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
