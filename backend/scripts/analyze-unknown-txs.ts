/**
 * Analyze UNKNOWN and TRANSFER_OUT on-chain transactions
 *
 * Groups by destination addresses, Helius type, fee patterns, value ranges.
 * Samples raw data to understand the structure of unclassified transactions.
 *
 * Usage:
 *   cd backend
 *   NODE_PATH=libs/database/node_modules npx tsx scripts/analyze-unknown-txs.ts
 */

import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const OUTPUT_DIR = join(__dirname, 'audit-output');
mkdirSync(OUTPUT_DIR, { recursive: true });

function writeJson(name: string, data: any) {
  writeFileSync(join(OUTPUT_DIR, name), JSON.stringify(data, null, 2));
  console.log(`  [file] ${name}`);
}

function writeTxt(name: string, text: string) {
  writeFileSync(join(OUTPUT_DIR, name), text);
  console.log(`  [file] ${name}`);
}

const KNOWN_PROGRAMS: Record<string, string> = {
  '11111111111111111111111111111111': 'System Program',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'Token Program',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': 'Token-2022 Program',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'Associated Token Account Program',
  'ComputeBudget111111111111111111111111111111': 'Compute Budget Program',
  'BPFLoaderUpgradeab1e11111111111111111111111': 'BPF Loader Upgradeable',
  'BPFLoader2111111111111111111111111111111111': 'BPF Loader 2',
  'Vote111111111111111111111111111111111111111': 'Vote Program',
  'Stake11111111111111111111111111111111111111': 'Stake Program',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr': 'Memo Program v2',
  'Memo1UhkJBfCR6MNBSmgoVzHUpLVvES8jVqnVXk9Gv4b': 'Memo Program v1',
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': 'Metaplex Token Metadata',
  'namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX': 'Solana Name Service',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter v6',
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB': 'Jupiter v4',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca Whirlpool',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM v4',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'Meteora DLMM',
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB': 'Meteora Pools',
  'MagicEd1e64FQ6LrmN5BDCz6KPHtifrqi33hzx2E1jF5': 'Magic Eden v2',
  'M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K': 'Magic Eden v2 (M2)',
  'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY': 'Bubblegum (cNFTs)',
  'TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN': 'Tensor Swap',
  'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH': 'Drift Protocol',
  'So1endDq2YkqhipRh3WViPa8hFvz0XP1SOdmE3jiHkn': 'Solend',
  'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA': 'Marinade Finance',
  'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD': 'Marinade Native Staking',
  'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy': 'Stake Pool Program',
  'stkitrT1Uoy18Dk1fTrgPw8W6MVzoCfYoAFT4MLsmhq': 'Sanctum Router',
  '5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx': 'Sanctum Infinity',
  'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY': 'Phoenix DEX',
  'SysvarRent111111111111111111111111111111111': 'Sysvar Rent',
  'SysvarC1ock11111111111111111111111111111111': 'Sysvar Clock',
};

async function main() {
  console.log('='.repeat(80));
  console.log('AuditSwarm: UNKNOWN & TRANSFER_OUT Transaction Analysis');
  console.log('='.repeat(80));

  const result: any = {
    summary: {}, heliusTypeBreakdown: {}, feeDistribution: [] as any[],
    valueDistribution: [] as any[], destinationAnalysis: [] as any[],
    programInteractions: [] as any[], patterns: {},
    sampleTransactions: [] as any[], suggestedReclassifications: [] as any[],
  };

  const lines: string[] = [];
  function log(msg: string) { console.log(msg); lines.push(msg); }

  // SECTION 1
  log('\n' + '='.repeat(80));
  log('SECTION 1: HIGH-LEVEL SUMMARY');
  log('='.repeat(80));

  const summaryRows: any[] = await prisma.$queryRawUnsafe(`
    SELECT t.type, COUNT(*)::int AS total,
      COUNT(DISTINCT CASE WHEN tf.id IS NOT NULL THEN t.id END)::int AS with_flows,
      COUNT(DISTINCT CASE WHEN tf.id IS NULL THEN t.id END)::int AS without_flows,
      SUM(COALESCE(t."totalValueUsd", 0))::text AS total_usd,
      AVG(t.fee)::text AS avg_fee_lamports
    FROM transactions t
    LEFT JOIN transaction_flows tf ON tf."transactionId" = t.id
    WHERE t.source = 'ONCHAIN' AND t.type IN ('UNKNOWN', 'TRANSFER_OUT')
    GROUP BY t.type ORDER BY total DESC
  `);
  for (const r of summaryRows) {
    log(`  ${r.type}: ${r.total} txs, ${r.with_flows} with flows, ${r.without_flows} without, $${parseFloat(r.total_usd || '0').toFixed(2)} USD`);
  }
  result.summary = summaryRows;

  // SECTION 2
  log('\n' + '='.repeat(80));
  log('SECTION 2: HELIUS TYPE BREAKDOWN (from TransactionEnrichment)');
  log('='.repeat(80));

  const heliusTypes: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(e."heliusType", '(no enrichment)') AS helius_type,
      COALESCE(e."heliusSource", '(none)') AS helius_source, COUNT(*)::int AS cnt
    FROM transactions t
    LEFT JOIN transaction_enrichments e ON e."transactionId" = t.id
    WHERE t.source = 'ONCHAIN' AND t.type IN ('UNKNOWN', 'TRANSFER_OUT')
    GROUP BY e."heliusType", e."heliusSource" ORDER BY cnt DESC
  `);
  for (const r of heliusTypes) {
    log(`  ${r.helius_type} / ${r.helius_source}: ${r.cnt}`);
    result.heliusTypeBreakdown[`${r.helius_type}/${r.helius_source}`] = r.cnt;
  }

  // SECTION 3
  log('\n' + '='.repeat(80));
  log('SECTION 3: HELIUS TYPE FROM rawData FIELD');
  log('='.repeat(80));

  const rawTypes: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(t."rawData"->>'type', '(null)') AS raw_type,
      COALESCE(t."rawData"->>'source', '(null)') AS raw_source,
      COUNT(*)::int AS cnt, SUM(COALESCE(t."totalValueUsd", 0))::text AS total_usd,
      AVG(t.fee)::text AS avg_fee
    FROM transactions t
    WHERE t.source = 'ONCHAIN' AND t.type IN ('UNKNOWN', 'TRANSFER_OUT') AND t."rawData" IS NOT NULL
    GROUP BY t."rawData"->>'type', t."rawData"->>'source' ORDER BY cnt DESC
  `);
  for (const r of rawTypes) {
    log(`  ${r.raw_type} / ${r.raw_source}: ${r.cnt} txs, $${parseFloat(r.total_usd || '0').toFixed(2)}, avg fee ${parseFloat(r.avg_fee || '0').toFixed(0)} lamports`);
  }

  // SECTION 4
  log('\n' + '='.repeat(80));
  log('SECTION 4: FEE DISTRIBUTION');
  log('='.repeat(80));

  const feeBuckets: any[] = await prisma.$queryRawUnsafe(`
    SELECT CASE
      WHEN fee IS NULL THEN 'NULL'
      WHEN fee < 5000 THEN '<5K lamports (base fee)'
      WHEN fee < 10000 THEN '5K-10K lamports'
      WHEN fee < 50000 THEN '10K-50K lamports'
      WHEN fee < 200000 THEN '50K-200K lamports (priority fee)'
      WHEN fee < 1000000 THEN '200K-1M lamports'
      ELSE '>1M lamports'
    END AS fee_bucket, COUNT(*)::int AS cnt
    FROM transactions WHERE source = 'ONCHAIN' AND type IN ('UNKNOWN', 'TRANSFER_OUT')
    GROUP BY fee_bucket ORDER BY cnt DESC
  `);
  for (const r of feeBuckets) {
    log(`  ${r.fee_bucket}: ${r.cnt}`);
    result.feeDistribution.push({ bucket: r.fee_bucket, count: r.cnt });
  }

  // SECTION 5
  log('\n' + '='.repeat(80));
  log('SECTION 5: VALUE DISTRIBUTION (totalValueUsd)');
  log('='.repeat(80));

  const valueBuckets: any[] = await prisma.$queryRawUnsafe(`
    SELECT CASE
      WHEN "totalValueUsd" IS NULL OR "totalValueUsd" = 0 THEN '$0 or NULL'
      WHEN "totalValueUsd" < 0.01 THEN '<$0.01'
      WHEN "totalValueUsd" < 0.10 THEN '$0.01-$0.10'
      WHEN "totalValueUsd" < 1.00 THEN '$0.10-$1.00'
      WHEN "totalValueUsd" < 10.00 THEN '$1-$10'
      WHEN "totalValueUsd" < 100.00 THEN '$10-$100'
      WHEN "totalValueUsd" < 1000.00 THEN '$100-$1,000'
      ELSE '>$1,000'
    END AS value_bucket, COUNT(*)::int AS cnt, SUM("totalValueUsd")::text AS total_usd
    FROM transactions WHERE source = 'ONCHAIN' AND type IN ('UNKNOWN', 'TRANSFER_OUT')
    GROUP BY value_bucket ORDER BY cnt DESC
  `);
  for (const r of valueBuckets) {
    log(`  ${r.value_bucket}: ${r.cnt} txs ($${parseFloat(r.total_usd || '0').toFixed(2)} total)`);
    result.valueDistribution.push({ bucket: r.value_bucket, count: r.cnt });
  }

  // SECTION 6: Deep pattern analysis
  log('\n' + '='.repeat(80));
  log('SECTION 6: DEEP PATTERN ANALYSIS');
  log('='.repeat(80));

  const wallets: any[] = await prisma.$queryRawUnsafe('SELECT id, address FROM wallets');
  const walletIdToAddress: Record<string, string> = {};
  for (const w of wallets) walletIdToAddress[w.id] = w.address;

  log('\n  Loading all UNKNOWN/TRANSFER_OUT transactions...');

  const allTxs: any[] = await prisma.$queryRawUnsafe(`
    SELECT t.id, t.signature, t.type, t."walletId", t.fee, t."feePayer",
      t."totalValueUsd"::text AS value_usd, t."rawData"
    FROM transactions t
    WHERE t.source = 'ONCHAIN' AND t.type IN ('UNKNOWN', 'TRANSFER_OUT')
    ORDER BY t.timestamp DESC
  `);

  log(`  Total transactions to analyze: ${allTxs.length}`);

  const destinationMap: Record<string, {
    txCount: number; totalLamports: bigint; totalUsd: number;
    amounts: number[]; sampleSigs: string[]; heliusTypes: Set<string>;
  }> = {};

  const programMap: Record<string, number> = {};
  const patternBuckets: Record<string, { count: number; sigs: string[] }> = {};
  const samplesByPattern: Record<string, any[]> = {};

  function addToPattern(pattern: string, sig: string) {
    if (!patternBuckets[pattern]) patternBuckets[pattern] = { count: 0, sigs: [] };
    patternBuckets[pattern].count++;
    if (patternBuckets[pattern].sigs.length < 5) patternBuckets[pattern].sigs.push(sig);
  }
  function addSample(pattern: string, data: any) {
    if (!samplesByPattern[pattern]) samplesByPattern[pattern] = [];
    if (samplesByPattern[pattern].length < 3) samplesByPattern[pattern].push(data);
  }

  for (const tx of allTxs) {
    const raw = tx.rawData as any;
    const sig = tx.signature || '(no sig)';
    const walletAddr = walletIdToAddress[tx.walletId] || '';
    if (!raw) { addToPattern('NO_RAW_DATA', sig); continue; }

    const heliusType = raw.type || 'UNKNOWN';
    const heliusSource = raw.source || '';
    const instructions: any[] = raw.instructions || [];
    const nativeTransfers: any[] = raw.nativeTransfers || [];
    const tokenTransfers: any[] = raw.tokenTransfers || [];
    const accountData: any[] = raw.accountData || [];

    for (const ix of instructions) {
      if (ix.programId) programMap[ix.programId] = (programMap[ix.programId] || 0) + 1;
      for (const inner of ix.innerInstructions || []) {
        if (inner.programId) programMap[inner.programId] = (programMap[inner.programId] || 0) + 1;
      }
    }

    const programIds = new Set<string>();
    for (const ix of instructions) { if (ix.programId) programIds.add(ix.programId); }

    const isComputeBudgetOnly = instructions.length > 0 &&
      instructions.every((ix: any) => ix.programId === 'ComputeBudget111111111111111111111111111111');
    const hasBpfLoader = programIds.has('BPFLoaderUpgradeab1e11111111111111111111111') ||
      programIds.has('BPFLoader2111111111111111111111111111111111');
    const hasSystemProgram = programIds.has('11111111111111111111111111111111');
    const hasATA = programIds.has('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    const hasTokenProgram = programIds.has('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') ||
      programIds.has('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
    const hasStaking = programIds.has('Stake11111111111111111111111111111111111111') ||
      programIds.has('MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA') ||
      programIds.has('MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD') ||
      programIds.has('SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy') ||
      programIds.has('stkitrT1Uoy18Dk1fTrgPw8W6MVzoCfYoAFT4MLsmhq') ||
      programIds.has('5ocnV1qiCgaQR8Jb8xWnVbApfaygJ8tNoZfgPwsgx9kx');
    const hasDefi = programIds.has('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4') ||
      programIds.has('JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB') ||
      programIds.has('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc') ||
      programIds.has('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8') ||
      programIds.has('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK') ||
      programIds.has('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo') ||
      programIds.has('PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY') ||
      programIds.has('dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH') ||
      programIds.has('So1endDq2YkqhipRh3WViPa8hFvz0XP1SOdmE3jiHkn');
    const hasNft = programIds.has('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s') ||
      programIds.has('MagicEd1e64FQ6LrmN5BDCz6KPHtifrqi33hzx2E1jF5') ||
      programIds.has('M2mx93ekt1fmXSVkTrUL9xVFHkmME8HTUi5Cyc5aF7K') ||
      programIds.has('BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY') ||
      programIds.has('TSWAPaqyCSx2KABk68Shruf4rp7CxcNi8hAsbdwmHbN');
    const hasMemo = programIds.has('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') ||
      programIds.has('Memo1UhkJBfCR6MNBSmgoVzHUpLVvES8jVqnVXk9Gv4b');

    let walletSolDelta = 0;
    for (const ad of accountData) {
      if ((ad.account || '').toLowerCase() === walletAddr.toLowerCase()) {
        walletSolDelta = ad.nativeBalanceChange || 0; break;
      }
    }

    const txFee = typeof tx.fee === 'bigint' ? Number(tx.fee) : Number(tx.fee || 0);
    const isFeePayerOnly = walletSolDelta !== 0 && Math.abs(walletSolDelta + txFee) < 100;

    for (const nt of nativeTransfers) {
      const from = (nt.fromUserAccount || '').toLowerCase();
      const to = (nt.toUserAccount || '').toLowerCase();
      const amount = nt.amount || 0;
      if (from === walletAddr.toLowerCase() && to && to !== walletAddr.toLowerCase()) {
        if (!destinationMap[to]) {
          destinationMap[to] = { txCount: 0, totalLamports: BigInt(0), totalUsd: 0, amounts: [], sampleSigs: [], heliusTypes: new Set() };
        }
        const dest = destinationMap[to];
        dest.txCount++; dest.totalLamports += BigInt(amount);
        dest.totalUsd += parseFloat(tx.value_usd || '0');
        dest.amounts.push(amount / 1e9);
        if (dest.sampleSigs.length < 3) dest.sampleSigs.push(sig);
        dest.heliusTypes.add(heliusType);
      }
    }

    if (isComputeBudgetOnly) {
      addToPattern('COMPUTE_BUDGET_ONLY', sig);
      addSample('COMPUTE_BUDGET_ONLY', { sig, heliusType, heliusSource, programIds: [...programIds], walletSolDelta, fee: txFee });
    } else if (hasBpfLoader) {
      addToPattern('BPF_LOADER_INTERACTION', sig);
      addSample('BPF_LOADER_INTERACTION', { sig, heliusType, heliusSource, programIds: [...programIds], walletSolDelta, fee: txFee });
    } else if (hasStaking) {
      addToPattern('STAKING', sig);
      addSample('STAKING', { sig, heliusType, heliusSource, programIds: [...programIds], walletSolDelta, fee: txFee });
    } else if (hasDefi && tokenTransfers.length > 0) {
      addToPattern('DEFI_INTERACTION', sig);
      addSample('DEFI_INTERACTION', { sig, heliusType, heliusSource, programIds: [...programIds], tokenTransfers: tokenTransfers.slice(0, 3), walletSolDelta, fee: txFee });
    } else if (hasDefi) {
      addToPattern('DEFI_NO_TOKEN_TRANSFER', sig);
      addSample('DEFI_NO_TOKEN_TRANSFER', { sig, heliusType, heliusSource, programIds: [...programIds], nativeTransfers, walletSolDelta, fee: txFee });
    } else if (hasNft) {
      addToPattern('NFT_OPERATION', sig);
      addSample('NFT_OPERATION', { sig, heliusType, heliusSource, programIds: [...programIds], walletSolDelta, fee: txFee });
    } else if (isFeePayerOnly && !hasTokenProgram && nativeTransfers.length <= 1) {
      addToPattern('FEE_PAYER_ONLY', sig);
      addSample('FEE_PAYER_ONLY', { sig, heliusType, heliusSource, programIds: [...programIds], walletSolDelta, fee: txFee, nativeTransfers });
    } else if (hasATA || (hasSystemProgram && hasTokenProgram && nativeTransfers.length > 0)) {
      const allSmall = nativeTransfers.every((nt: any) => (nt.amount || 0) < 5000000);
      if (allSmall || hasATA) {
        addToPattern('ACCOUNT_CREATION_RENT', sig);
        addSample('ACCOUNT_CREATION_RENT', { sig, heliusType, heliusSource, programIds: [...programIds], nativeTransfers, walletSolDelta, fee: txFee });
      } else {
        addToPattern('SYSTEM_TOKEN_INTERACTION', sig);
        addSample('SYSTEM_TOKEN_INTERACTION', { sig, heliusType, heliusSource, programIds: [...programIds], nativeTransfers, tokenTransfers: tokenTransfers.slice(0, 3), walletSolDelta, fee: txFee });
      }
    } else if (walletSolDelta === 0 && tokenTransfers.length === 0 && nativeTransfers.length === 0) {
      addToPattern('ZERO_VALUE_NO_TRANSFERS', sig);
      addSample('ZERO_VALUE_NO_TRANSFERS', { sig, heliusType, heliusSource, programIds: [...programIds], fee: txFee });
    } else if (hasMemo && instructions.length <= 2) {
      addToPattern('MEMO_TRANSACTION', sig);
      addSample('MEMO_TRANSACTION', { sig, heliusType, heliusSource, programIds: [...programIds], walletSolDelta, fee: txFee });
    } else if (nativeTransfers.length > 0) {
      const maxAmt = Math.max(...nativeTransfers.map((nt: any) => nt.amount || 0));
      if (maxAmt < 10000000) {
        addToPattern('SMALL_RENT_LIKE_PAYMENT', sig);
        addSample('SMALL_RENT_LIKE_PAYMENT', { sig, heliusType, heliusSource, programIds: [...programIds], nativeTransfers, walletSolDelta, fee: txFee });
      } else {
        addToPattern('SOL_TRANSFER_UNCLASSIFIED', sig);
        addSample('SOL_TRANSFER_UNCLASSIFIED', { sig, heliusType, heliusSource, programIds: [...programIds], nativeTransfers, walletSolDelta, fee: txFee });
      }
    } else if (tokenTransfers.length > 0) {
      addToPattern('TOKEN_TRANSFER_UNCLASSIFIED', sig);
      addSample('TOKEN_TRANSFER_UNCLASSIFIED', { sig, heliusType, heliusSource, programIds: [...programIds], tokenTransfers: tokenTransfers.slice(0, 3), walletSolDelta, fee: txFee });
    } else {
      addToPattern('TRULY_UNKNOWN', sig);
      addSample('TRULY_UNKNOWN', { sig, heliusType, heliusSource, programIds: [...programIds], walletSolDelta, fee: txFee, description: raw.description });
    }
  }

  // SECTION 7
  log('\n' + '='.repeat(80));
  log('SECTION 7: PATTERN CLASSIFICATION RESULTS');
  log('='.repeat(80));

  const sortedPatterns = Object.entries(patternBuckets).sort((a, b) => b[1].count - a[1].count);
  let totalClassified = 0;
  for (const [pattern, data] of sortedPatterns) {
    totalClassified += data.count;
    log(`  ${pattern}: ${data.count} txs`);
    for (const sig of data.sigs.slice(0, 2)) { log(`    sample: ${sig.slice(0, 50)}...`); }
  }
  log(`\n  Total classified: ${totalClassified} / ${allTxs.length}`);
  result.patterns = Object.fromEntries(sortedPatterns.map(([p, d]) => [p, d.count]));

  // SECTION 8
  log('\n' + '='.repeat(80));
  log('SECTION 8: PROGRAM INTERACTION FREQUENCY (top 30)');
  log('='.repeat(80));

  const sortedPrograms = Object.entries(programMap).sort((a, b) => b[1] - a[1]).slice(0, 30);
  for (const [pid, count] of sortedPrograms) {
    const name = KNOWN_PROGRAMS[pid] || '(unknown)';
    log(`  ${name.padEnd(42)} ${pid.slice(0, 24)}... : ${count}`);
    result.programInteractions.push({ programId: pid, name, count });
  }

  // SECTION 9
  log('\n' + '='.repeat(80));
  log('SECTION 9: TOP DESTINATION ADDRESSES (by tx count)');
  log('='.repeat(80));

  const knownAddrs: any[] = await prisma.$queryRawUnsafe('SELECT address, name, label, "entityType" FROM known_addresses');
  const knownMap: Record<string, string> = {};
  for (const ka of knownAddrs) knownMap[ka.address.toLowerCase()] = `${ka.name} (${ka.label}, ${ka.entityType})`;

  const sortedDests = Object.entries(destinationMap).sort((a, b) => b[1].txCount - a[1].txCount).slice(0, 30);
  for (const [addr, data] of sortedDests) {
    const knownName = knownMap[addr] || KNOWN_PROGRAMS[addr] || null;
    const totalSol = Number(data.totalLamports) / 1e9;
    const avgSol = totalSol / data.txCount;
    const minSol = data.amounts.length > 0 ? Math.min(...data.amounts) : 0;
    const maxSol = data.amounts.length > 0 ? Math.max(...data.amounts) : 0;
    let pattern = 'UNCLASSIFIED';
    if (KNOWN_PROGRAMS[addr]) pattern = 'PROGRAM_ACCOUNT';
    else if (data.txCount > 5 && avgSol < 0.01) pattern = 'RENT/ACCOUNT_CREATION';
    else if (data.txCount > 3 && maxSol - minSol < 0.001) pattern = 'CONSISTENT_AMOUNT';
    else if (data.txCount === 1 && totalSol > 1) pattern = 'LARGE_SINGLE_TRANSFER';
    else if (data.txCount > 1) pattern = 'REPEATED_RECIPIENT';

    result.destinationAnalysis.push({
      address: addr, knownName, txCount: data.txCount,
      totalSolSent: totalSol.toFixed(9), totalUsdValue: data.totalUsd.toFixed(2),
      avgSolPerTx: avgSol.toFixed(9), minSol: minSol.toFixed(9), maxSol: maxSol.toFixed(9),
      pattern, heliusTypes: [...data.heliusTypes],
    });
    log(`  ${addr.slice(0, 20)}...${addr.slice(-8)}`);
    log(`    Known: ${knownName || 'NO'}`);
    log(`    Txs: ${data.txCount}, Total SOL: ${totalSol.toFixed(6)}, USD: $${data.totalUsd.toFixed(2)}`);
    log(`    Avg: ${avgSol.toFixed(6)} SOL, Min: ${minSol.toFixed(6)}, Max: ${maxSol.toFixed(6)}`);
    log(`    Pattern: ${pattern}, Helius types: ${[...data.heliusTypes].join(', ')}`);
    log('');
  }

  // SECTION 10
  log('\n' + '='.repeat(80));
  log('SECTION 10: SAMPLE RAW DATA (diverse patterns)');
  log('='.repeat(80));

  const samples: any[] = [];
  for (const [pattern, ps] of Object.entries(samplesByPattern)) {
    if (samples.length >= 10) break;
    for (const s of ps) { if (samples.length >= 10) break; samples.push({ pattern, ...s }); }
  }
  for (const sample of samples) {
    if (!sample.sig || sample.sig === '(no sig)') continue;
    const fullTx: any[] = await prisma.$queryRawUnsafe(
      `SELECT t."rawData", t.type, t.category, t."totalValueUsd"::text AS value_usd, t.fee::text, t."feePayer" FROM transactions t WHERE t.signature = $1 LIMIT 1`,
      sample.sig
    );
    if (fullTx.length > 0) {
      const rd = fullTx[0].rawData as any;
      sample.fullRawData = rd; sample.dbType = fullTx[0].type; sample.dbCategory = fullTx[0].category;
      log(`\n  --- Sample: ${sample.pattern} ---`);
      log(`  Signature: ${sample.sig}`);
      log(`  DB Type: ${sample.dbType}, Category: ${sample.dbCategory || 'null'}`);
      log(`  Helius Type: ${rd?.type || '?'} / Source: ${rd?.source || '?'}`);
      log(`  Description: ${rd?.description || '(none)'}`);
      log(`  Fee: ${fullTx[0].fee} lamports, FeePayer: ${fullTx[0].feePayer}`);
      log(`  Value USD: $${fullTx[0].value_usd || '0'}`);
      log(`  Instructions (${(rd?.instructions || []).length}): ${(rd?.instructions || []).map((i: any) => KNOWN_PROGRAMS[i.programId] || (i.programId || '').slice(0, 24)).join(', ')}`);
      log(`  Native transfers (${(rd?.nativeTransfers || []).length}):`);
      for (const nt of (rd?.nativeTransfers || []).slice(0, 5)) {
        log(`    ${(nt.fromUserAccount || '?').slice(0, 20)}... -> ${(nt.toUserAccount || '?').slice(0, 20)}... : ${((nt.amount || 0) / 1e9).toFixed(9)} SOL`);
      }
      log(`  Token transfers (${(rd?.tokenTransfers || []).length}):`);
      for (const tt of (rd?.tokenTransfers || []).slice(0, 5)) {
        log(`    ${(tt.fromUserAccount || '?').slice(0, 20)}... -> ${(tt.toUserAccount || '?').slice(0, 20)}... : ${tt.tokenAmount || '?'} of ${(tt.mint || '?').slice(0, 20)}...`);
      }
      log(`  Account data entries: ${(rd?.accountData || []).length}`);
    }
  }
  result.sampleTransactions = samples;

  // SECTION 11
  log('\n' + '='.repeat(80));
  log('SECTION 11: RECLASSIFICATION SUGGESTIONS');
  log('='.repeat(80));

  const reclassMap: Record<string, { type: string; category: string }> = {
    'STAKING': { type: 'STAKE', category: 'STAKING' },
    'DEFI_INTERACTION': { type: 'SWAP', category: 'DEFI' },
    'DEFI_NO_TOKEN_TRANSFER': { type: 'DEFI_INTERACTION', category: 'DEFI' },
    'NFT_OPERATION': { type: 'NFT_TRANSACTION', category: 'NFT' },
    'BPF_LOADER_INTERACTION': { type: 'PROGRAM_INTERACTION', category: 'DEVELOPMENT' },
    'ACCOUNT_CREATION_RENT': { type: 'ACCOUNT_CREATION', category: 'BLOCKCHAIN_FEE' },
    'COMPUTE_BUDGET_ONLY': { type: 'FAILED_OR_EMPTY', category: 'BLOCKCHAIN_FEE' },
    'FEE_PAYER_ONLY': { type: 'FEE_PAYMENT', category: 'BLOCKCHAIN_FEE' },
    'ZERO_VALUE_NO_TRANSFERS': { type: 'PROGRAM_INTERACTION', category: 'BLOCKCHAIN_FEE' },
    'SMALL_RENT_LIKE_PAYMENT': { type: 'RENT_PAYMENT', category: 'BLOCKCHAIN_FEE' },
    'MEMO_TRANSACTION': { type: 'MEMO', category: 'OTHER' },
    'SOL_TRANSFER_UNCLASSIFIED': { type: 'TRANSFER_OUT', category: 'TRANSFER' },
    'TOKEN_TRANSFER_UNCLASSIFIED': { type: 'TRANSFER_OUT', category: 'TRANSFER' },
    'SYSTEM_TOKEN_INTERACTION': { type: 'TOKEN_INTERACTION', category: 'DEFI' },
  };
  for (const [pattern, data] of sortedPatterns) {
    const reclass = reclassMap[pattern];
    if (reclass) {
      result.suggestedReclassifications.push({ pattern, count: data.count, suggestedType: reclass.type, suggestedCategory: reclass.category, sampleSignatures: data.sigs });
      log(`  ${pattern} (${data.count} txs) -> type=${reclass.type}, category=${reclass.category}`);
    } else {
      log(`  ${pattern} (${data.count} txs) -> NEEDS MANUAL REVIEW`);
    }
  }

  // SECTION 12
  log('\n' + '='.repeat(80));
  log('SECTION 12: HELIUS TYPE -> DB TYPE CROSS-REFERENCE');
  log('='.repeat(80));
  const crossRef: any[] = await prisma.$queryRawUnsafe(`
    SELECT COALESCE(t."rawData"->>'type', '(null)') AS helius_type, t.type AS db_type, COUNT(*)::int AS cnt,
      ARRAY_AGG(DISTINCT t.category) AS categories, MIN(t."totalValueUsd")::text AS min_usd, MAX(t."totalValueUsd")::text AS max_usd
    FROM transactions t WHERE t.source = 'ONCHAIN' AND t.type IN ('UNKNOWN', 'TRANSFER_OUT')
    GROUP BY t."rawData"->>'type', t.type ORDER BY cnt DESC
  `);
  for (const r of crossRef) {
    log(`  Helius "${r.helius_type}" -> DB "${r.db_type}": ${r.cnt} txs, USD [$${parseFloat(r.min_usd || '0').toFixed(4)} - $${parseFloat(r.max_usd || '0').toFixed(4)}]`);
    log(`    Categories: ${(r.categories || []).join(', ')}`);
  }

  // SECTION 13
  log('\n' + '='.repeat(80));
  log('SECTION 13: PER-WALLET BREAKDOWN');
  log('='.repeat(80));
  const perWallet: any[] = await prisma.$queryRawUnsafe(`
    SELECT w.address, w.label, COUNT(*)::int AS unknown_count, SUM(COALESCE(t."totalValueUsd", 0))::text AS total_usd
    FROM transactions t JOIN wallets w ON w.id = t."walletId"
    WHERE t.source = 'ONCHAIN' AND t.type IN ('UNKNOWN', 'TRANSFER_OUT')
    GROUP BY w.address, w.label ORDER BY unknown_count DESC
  `);
  for (const r of perWallet) {
    log(`  ${r.label || '(unlabeled)'} (${r.address.slice(0, 16)}...): ${r.unknown_count} txs, $${parseFloat(r.total_usd || '0').toFixed(2)}`);
  }

  // SECTION 14
  log('\n' + '='.repeat(80));
  log('SECTION 14: TIMELINE DISTRIBUTION (monthly)');
  log('='.repeat(80));
  const monthly: any[] = await prisma.$queryRawUnsafe(`
    SELECT TO_CHAR(t.timestamp, 'YYYY-MM') AS month, COUNT(*)::int AS cnt,
      SUM(COALESCE(t."totalValueUsd", 0))::text AS total_usd
    FROM transactions t WHERE t.source = 'ONCHAIN' AND t.type IN ('UNKNOWN', 'TRANSFER_OUT')
    GROUP BY month ORDER BY month
  `);
  for (const r of monthly) {
    log(`  ${r.month}: ${r.cnt} txs, $${parseFloat(r.total_usd || '0').toFixed(2)}`);
  }

  // Write output
  log('\n' + '='.repeat(80));
  log('WRITING OUTPUT FILES');
  log('='.repeat(80));
  writeJson('unknown-analysis.json', result);
  writeTxt('unknown-analysis.txt', lines.join('\n'));
  log('\nAnalysis complete.');
}

main()
  .catch((err) => { console.error('ERROR:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
