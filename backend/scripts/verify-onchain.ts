/**
 * On-Chain Balance Verification Script
 *
 * Fetches ALL enhanced transactions from Helius for a wallet, compares
 * Helius nativeBalanceChange deltas with DB TransactionFlow records,
 * and fetches real-time RPC balances as ground truth.
 *
 * Outputs:
 *   audit-output/onchain-raw-txs.json            — full Helius responses
 *   audit-output/onchain-summary.json             — per-tx: sig, type, solDelta, splDeltas, fee
 *   audit-output/onchain-verification-report.txt  — human-readable comparison report
 *
 * Usage:
 *   cd auditswarm/backend
 *   NODE_PATH=libs/database/node_modules npx tsx scripts/verify-onchain.ts
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

const prisma = new PrismaClient();
const OUTPUT_DIR = join(__dirname, 'audit-output');
mkdirSync(OUTPUT_DIR, { recursive: true });

function writeJson(name: string, data: any) {
  writeFileSync(join(OUTPUT_DIR, name), JSON.stringify(data, null, 2));
  console.log(`  Wrote ${name}`);
}

function writeTxt(name: string, text: string) {
  writeFileSync(join(OUTPUT_DIR, name), text);
  console.log(`  Wrote ${name}`);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// =========================================================================
// 1. Fetch all enhanced transactions from Helius
// =========================================================================
async function fetchAllHeliusTxs(wallet: string): Promise<any[]> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('HELIUS_API_KEY not set');

  const allTxs: any[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (true) {
    const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${apiKey}&limit=100${cursor ? `&before=${cursor}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Helius API ${res.status}: ${await res.text()}`);
    const batch: any[] = await res.json();
    if (!batch.length) break;

    allTxs.push(...batch);
    cursor = batch[batch.length - 1].signature;
    page++;
    console.log(`  Helius page ${page}: ${batch.length} txs (total: ${allTxs.length})`);
    await sleep(250);
  }

  return allTxs;
}

// =========================================================================
// 2. Extract per-tx summary from Helius raw data
// =========================================================================
interface TxSummary {
  signature: string;
  type: string;
  timestamp: number;
  fee: number;
  feePayer: string;
  solDeltaLamports: number;
  splDeltas: { mint: string; rawDelta: string; decimals: number }[];
}

function summarizeTx(tx: any, walletAddress: string): TxSummary {
  const walletAddr = walletAddress.toLowerCase();
  const accountData: any[] = tx.accountData ?? [];
  let solDeltaLamports = 0;

  for (const ad of accountData) {
    if ((ad.account ?? '').toLowerCase() === walletAddr) {
      solDeltaLamports = ad.nativeBalanceChange ?? 0;
      break;
    }
  }

  const splDeltas: TxSummary['splDeltas'] = [];
  for (const ad of accountData) {
    for (const tbc of ad.tokenBalanceChanges ?? []) {
      if ((tbc.userAccount ?? '').toLowerCase() !== walletAddr) continue;
      const mint = tbc.mint ?? '';
      if (!mint) continue;
      const rawStr = tbc.rawTokenAmount?.tokenAmount ?? '0';
      const decimals = tbc.rawTokenAmount?.decimals ?? 0;
      if (rawStr === '0') continue;
      splDeltas.push({ mint, rawDelta: rawStr, decimals });
    }
  }

  return {
    signature: tx.signature,
    type: tx.type ?? 'UNKNOWN',
    timestamp: tx.timestamp ?? 0,
    fee: tx.fee ?? 0,
    feePayer: tx.feePayer ?? '',
    solDeltaLamports,
    splDeltas,
  };
}

// =========================================================================
// 3. Fetch real-time RPC balances
// =========================================================================
interface RpcBalances {
  solLamports: number;
  solBalance: number;
  tokens: { mint: string; amount: string; decimals: number; uiAmount: number }[];
}

async function fetchRpcBalances(wallet: string): Promise<RpcBalances> {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error('SOLANA_RPC_URL not set');

  const connection = new Connection(rpcUrl);
  const pubkey = new PublicKey(wallet);

  const solLamports = await connection.getBalance(pubkey);
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, {
    programId: TOKEN_PROGRAM_ID,
  });

  const tokens = tokenAccounts.value.map(ta => {
    const info = ta.account.data.parsed.info;
    return {
      mint: info.mint as string,
      amount: info.tokenAmount.amount as string,
      decimals: info.tokenAmount.decimals as number,
      uiAmount: info.tokenAmount.uiAmount as number,
    };
  });

  return {
    solLamports,
    solBalance: solLamports / LAMPORTS_PER_SOL,
    tokens,
  };
}

// =========================================================================
// 4. Load DB flows for comparison
// =========================================================================
interface DbFlowRow {
  transactionId: string;
  signature: string | null;
  mint: string;
  rawAmount: string;
  direction: string;
  amount: Prisma.Decimal;
}

async function loadDbFlows(walletId: string): Promise<Map<string, DbFlowRow[]>> {
  const rows = await prisma.$queryRaw<DbFlowRow[]>`
    SELECT
      tf."transactionId",
      t."signature",
      tf."mint",
      tf."rawAmount",
      tf."direction",
      tf."amount"
    FROM transaction_flows tf
    JOIN transactions t ON t.id = tf."transactionId"
    WHERE tf."walletId" = ${walletId}
      AND t."source" = 'ONCHAIN'
    ORDER BY t."timestamp" ASC
  `;

  const map = new Map<string, DbFlowRow[]>();
  for (const r of rows) {
    const sig = r.signature ?? '';
    if (!map.has(sig)) map.set(sig, []);
    map.get(sig)!.push(r);
  }
  return map;
}

// =========================================================================
// 5. Compare and generate report
// =========================================================================
interface Mismatch {
  signature: string;
  type: string;
  mint: string;
  heliusDelta: string;
  dbDirection: string;
  dbAmount: string;
  expectedDirection: string;
  expectedAmount: string;
  diff: string;
}

function compare(
  summaries: TxSummary[],
  dbFlowMap: Map<string, DbFlowRow[]>,
  rpcBalances: RpcBalances,
  walletAddress: string,
): string {
  const lines: string[] = [];
  const p = (s: string) => lines.push(s);

  // --- Compute expected balances from Helius deltas ---
  let heliusSolNet = 0n;
  const heliusSplNet = new Map<string, bigint>(); // mint -> net raw

  for (const s of summaries) {
    heliusSolNet += BigInt(Math.round(s.solDeltaLamports));
    for (const spl of s.splDeltas) {
      const prev = heliusSplNet.get(spl.mint) ?? 0n;
      heliusSplNet.set(spl.mint, prev + BigInt(spl.rawDelta));
    }
  }

  // --- Compute DB flow net balances ---
  let dbSolNet = 0n;
  const dbSplNet = new Map<string, bigint>();

  for (const [, flows] of dbFlowMap) {
    for (const f of flows) {
      const raw = BigInt(f.rawAmount);
      const signed = f.direction === 'IN' ? raw : -raw;
      if (f.mint === SOL_MINT) {
        dbSolNet += signed;
      } else {
        const prev = dbSplNet.get(f.mint) ?? 0n;
        dbSplNet.set(f.mint, prev + signed);
      }
    }
  }

  // --- Header ---
  p('='.repeat(80));
  p('ON-CHAIN BALANCE VERIFICATION REPORT');
  p(`Wallet: ${walletAddress}`);
  p(`Generated: ${new Date().toISOString()}`);
  p('='.repeat(80));

  // --- SOL Balance Summary ---
  p('\n--- SOL BALANCE SUMMARY ---');
  p(`  RPC balance (ground truth):  ${rpcBalances.solBalance.toFixed(9)} SOL  (${rpcBalances.solLamports} lamports)`);
  p(`  Helius delta sum:            ${formatLamports(heliusSolNet)} SOL  (${heliusSolNet.toString()} lamports)`);
  p(`  DB flow net:                 ${formatLamports(dbSolNet)} SOL  (${dbSolNet.toString()} lamports)`);
  p('');
  const heliusVsRpc = heliusSolNet - BigInt(rpcBalances.solLamports);
  const dbVsRpc = dbSolNet - BigInt(rpcBalances.solLamports);
  const heliusVsDb = heliusSolNet - dbSolNet;
  p(`  Helius vs RPC diff:          ${formatLamports(heliusVsRpc)} SOL  (${heliusVsRpc.toString()} lamports)`);
  p(`  DB vs RPC diff:              ${formatLamports(dbVsRpc)} SOL  (${dbVsRpc.toString()} lamports)`);
  p(`  Helius vs DB diff:           ${formatLamports(heliusVsDb)} SOL  (${heliusVsDb.toString()} lamports)`);

  // --- SPL Balance Summary ---
  p('\n--- SPL TOKEN BALANCE SUMMARY ---');
  const allMints = new Set([...heliusSplNet.keys(), ...dbSplNet.keys()]);
  const rpcTokenMap = new Map<string, { amount: string; decimals: number; uiAmount: number }>();
  for (const t of rpcBalances.tokens) rpcTokenMap.set(t.mint, t);

  for (const mint of allMints) {
    const hNet = heliusSplNet.get(mint) ?? 0n;
    const dNet = dbSplNet.get(mint) ?? 0n;
    const rpc = rpcTokenMap.get(mint);
    const rpcAmt = rpc ? BigInt(rpc.amount) : 0n;
    const diff = hNet - dNet;
    if (diff !== 0n || hNet !== rpcAmt) {
      p(`  Mint: ${mint}`);
      p(`    RPC:    ${rpc ? rpc.uiAmount : 'not held'}`);
      p(`    Helius: ${hNet.toString()}`);
      p(`    DB:     ${dNet.toString()}`);
      p(`    H-D:    ${diff.toString()}`);
      p(`    H-RPC:  ${(hNet - rpcAmt).toString()}`);
    }
  }

  // --- Transaction count comparison ---
  const heliusSigs = new Set(summaries.map(s => s.signature));
  const dbSigs = new Set(dbFlowMap.keys());

  const inHeliusNotDb: string[] = [];
  const inDbNotHelius: string[] = [];
  for (const sig of heliusSigs) {
    if (!dbFlowMap.has(sig)) inHeliusNotDb.push(sig);
  }
  for (const sig of dbSigs) {
    if (!heliusSigs.has(sig)) inDbNotHelius.push(sig);
  }

  p('\n--- TRANSACTION COUNT ---');
  p(`  Helius transactions:         ${summaries.length}`);
  p(`  DB transactions with flows:  ${dbFlowMap.size}`);
  p(`  In Helius but not in DB:     ${inHeliusNotDb.length}`);
  p(`  In DB but not in Helius:     ${inDbNotHelius.length}`);

  if (inHeliusNotDb.length > 0) {
    p('\n--- MISSING FROM DB (in Helius, no DB flows) ---');
    for (const sig of inHeliusNotDb.slice(0, 50)) {
      const s = summaries.find(x => x.signature === sig)!;
      p(`  ${sig}  type=${s.type}  solDelta=${s.solDeltaLamports}  spl=${s.splDeltas.length}`);
    }
    if (inHeliusNotDb.length > 50) p(`  ... and ${inHeliusNotDb.length - 50} more`);
  }

  if (inDbNotHelius.length > 0) {
    p('\n--- EXTRA IN DB (in DB, not in Helius) ---');
    for (const sig of inDbNotHelius.slice(0, 50)) {
      p(`  ${sig}`);
    }
    if (inDbNotHelius.length > 50) p(`  ... and ${inDbNotHelius.length - 50} more`);
  }

  // --- Per-transaction flow mismatches ---
  const mismatches: Mismatch[] = [];
  const duplicates: { signature: string; mint: string; count: number }[] = [];

  for (const s of summaries) {
    const dbFlows = dbFlowMap.get(s.signature);
    if (!dbFlows) continue; // already reported as missing

    // Check SOL flow
    const solDelta = BigInt(Math.round(s.solDeltaLamports));
    const dbSolFlows = dbFlows.filter(f => f.mint === SOL_MINT);

    if (dbSolFlows.length > 1) {
      duplicates.push({ signature: s.signature, mint: SOL_MINT, count: dbSolFlows.length });
    }

    if (solDelta !== 0n) {
      const expectedDir = solDelta > 0n ? 'IN' : 'OUT';
      const expectedAbs = solDelta < 0n ? -solDelta : solDelta;

      if (dbSolFlows.length === 0) {
        mismatches.push({
          signature: s.signature,
          type: s.type,
          mint: SOL_MINT,
          heliusDelta: solDelta.toString(),
          dbDirection: 'MISSING',
          dbAmount: '0',
          expectedDirection: expectedDir,
          expectedAmount: expectedAbs.toString(),
          diff: expectedAbs.toString(),
        });
      } else {
        const dbFlow = dbSolFlows[0];
        const dbRaw = BigInt(dbFlow.rawAmount);
        if (dbRaw !== expectedAbs || dbFlow.direction !== expectedDir) {
          const dbSigned = dbFlow.direction === 'IN' ? dbRaw : -dbRaw;
          mismatches.push({
            signature: s.signature,
            type: s.type,
            mint: SOL_MINT,
            heliusDelta: solDelta.toString(),
            dbDirection: dbFlow.direction,
            dbAmount: dbRaw.toString(),
            expectedDirection: expectedDir,
            expectedAmount: expectedAbs.toString(),
            diff: (solDelta - dbSigned).toString(),
          });
        }
      }
    } else if (dbSolFlows.length > 0) {
      // Helius says 0 delta but DB has a flow
      mismatches.push({
        signature: s.signature,
        type: s.type,
        mint: SOL_MINT,
        heliusDelta: '0',
        dbDirection: dbSolFlows[0].direction,
        dbAmount: dbSolFlows[0].rawAmount,
        expectedDirection: 'NONE',
        expectedAmount: '0',
        diff: `-${dbSolFlows[0].rawAmount}`,
      });
    }

    // Check SPL flows
    for (const spl of s.splDeltas) {
      const dbSplFlows = dbFlows.filter(f => f.mint === spl.mint);
      if (dbSplFlows.length > 1) {
        duplicates.push({ signature: s.signature, mint: spl.mint, count: dbSplFlows.length });
      }

      const rawDelta = BigInt(spl.rawDelta);
      const expectedDir = rawDelta > 0n ? 'IN' : 'OUT';
      const expectedAbs = rawDelta < 0n ? -rawDelta : rawDelta;

      if (dbSplFlows.length === 0) {
        mismatches.push({
          signature: s.signature,
          type: s.type,
          mint: spl.mint,
          heliusDelta: rawDelta.toString(),
          dbDirection: 'MISSING',
          dbAmount: '0',
          expectedDirection: expectedDir,
          expectedAmount: expectedAbs.toString(),
          diff: expectedAbs.toString(),
        });
      } else {
        const dbFlow = dbSplFlows[0];
        const dbRaw = BigInt(dbFlow.rawAmount);
        if (dbRaw !== expectedAbs || dbFlow.direction !== expectedDir) {
          const dbSigned = dbFlow.direction === 'IN' ? dbRaw : -dbRaw;
          mismatches.push({
            signature: s.signature,
            type: s.type,
            mint: spl.mint,
            heliusDelta: rawDelta.toString(),
            dbDirection: dbFlow.direction,
            dbAmount: dbRaw.toString(),
            expectedDirection: expectedDir,
            expectedAmount: expectedAbs.toString(),
            diff: (rawDelta - dbSigned).toString(),
          });
        }
      }
    }

    // Check for DB flows with mints not in Helius data
    const heliusMints = new Set([SOL_MINT, ...s.splDeltas.map(d => d.mint)]);
    if (solDelta === 0n) heliusMints.delete(SOL_MINT);
    for (const f of dbFlows) {
      if (!heliusMints.has(f.mint) && !mismatches.some(m => m.signature === s.signature && m.mint === f.mint)) {
        mismatches.push({
          signature: s.signature,
          type: s.type,
          mint: f.mint,
          heliusDelta: '0',
          dbDirection: f.direction,
          dbAmount: f.rawAmount,
          expectedDirection: 'NONE',
          expectedAmount: '0',
          diff: `extra_db_flow`,
        });
      }
    }
  }

  // --- Mismatch summary ---
  p(`\n--- FLOW MISMATCHES (${mismatches.length}) ---`);
  if (mismatches.length === 0) {
    p('  No mismatches found! All DB flows match Helius data.');
  } else {
    // Group by mint
    const solMismatches = mismatches.filter(m => m.mint === SOL_MINT);
    const splMismatches = mismatches.filter(m => m.mint !== SOL_MINT);

    // SOL mismatches cumulative impact
    let solCumulativeDiff = 0n;
    for (const m of solMismatches) {
      if (m.diff !== 'extra_db_flow') {
        solCumulativeDiff += BigInt(m.diff);
      }
    }

    p(`\n  SOL mismatches: ${solMismatches.length} (cumulative diff: ${solCumulativeDiff.toString()} lamports = ${formatLamports(solCumulativeDiff)} SOL)`);
    for (const m of solMismatches.slice(0, 100)) {
      p(`    ${m.signature.slice(0, 20)}... type=${m.type} helius=${m.heliusDelta} db=${m.dbDirection}:${m.dbAmount} expected=${m.expectedDirection}:${m.expectedAmount} diff=${m.diff}`);
    }
    if (solMismatches.length > 100) p(`    ... and ${solMismatches.length - 100} more`);

    if (splMismatches.length > 0) {
      p(`\n  SPL mismatches: ${splMismatches.length}`);
      for (const m of splMismatches.slice(0, 50)) {
        p(`    ${m.signature.slice(0, 20)}... mint=${m.mint.slice(0, 10)}... type=${m.type} diff=${m.diff}`);
      }
      if (splMismatches.length > 50) p(`    ... and ${splMismatches.length - 50} more`);
    }
  }

  // --- Duplicates ---
  p(`\n--- DUPLICATE FLOWS (${duplicates.length}) ---`);
  if (duplicates.length === 0) {
    p('  No duplicates found.');
  } else {
    for (const d of duplicates) {
      p(`  ${d.signature.slice(0, 20)}... mint=${d.mint.slice(0, 10)}... count=${d.count}`);
    }
  }

  // --- Diagnosis ---
  p('\n--- DIAGNOSIS ---');
  if (heliusVsRpc === 0n) {
    p('  Helius delta sum matches RPC balance exactly.');
    p('  The issue is between Helius data and DB flows.');
  } else {
    p(`  Helius delta sum DOES NOT match RPC balance.`);
    p(`  Possible: wallet had a pre-existing balance before first Helius transaction,`);
    p(`  or Helius is missing some transactions.`);
    p(`  Gap: ${formatLamports(heliusVsRpc)} SOL (${heliusVsRpc.toString()} lamports)`);
  }

  if (heliusVsDb !== 0n) {
    p(`  Helius vs DB has a gap of ${formatLamports(heliusVsDb)} SOL`);
    if (inHeliusNotDb.length > 0) {
      // Sum the SOL deltas from missing txs
      let missingSolDelta = 0n;
      for (const sig of inHeliusNotDb) {
        const s = summaries.find(x => x.signature === sig);
        if (s) missingSolDelta += BigInt(Math.round(s.solDeltaLamports));
      }
      p(`  Missing tx SOL delta total: ${formatLamports(missingSolDelta)} SOL (${missingSolDelta.toString()} lamports)`);
    }
    if (mismatches.length > 0) {
      p(`  ${mismatches.length} flow amount/direction mismatches found.`);
    }
  } else {
    p('  Helius and DB flow nets match exactly.');
  }

  // Summarize root cause
  p('\n--- RECOMMENDED FIX ---');
  if (inHeliusNotDb.length > 0) {
    p(`  1. Index ${inHeliusNotDb.length} missing transactions and create flows for them.`);
  }
  if (mismatches.filter(m => m.dbDirection === 'MISSING').length > 0) {
    const missing = mismatches.filter(m => m.dbDirection === 'MISSING');
    p(`  2. Create missing flows for ${missing.length} transactions that exist in DB but have no flows.`);
  }
  if (mismatches.filter(m => m.dbDirection !== 'MISSING' && m.diff !== 'extra_db_flow').length > 0) {
    p(`  3. Fix ${mismatches.filter(m => m.dbDirection !== 'MISSING' && m.diff !== 'extra_db_flow').length} flow amount mismatches.`);
  }
  if (duplicates.length > 0) {
    p(`  4. Deduplicate ${duplicates.length} duplicate flows.`);
  }
  if (heliusVsRpc !== 0n && inHeliusNotDb.length === 0 && mismatches.length === 0) {
    p(`  The wallet likely had a pre-existing balance of ${formatLamports(-heliusVsRpc)} SOL`);
    p(`  before the first indexed transaction. Consider adding an "opening balance" flow.`);
  }

  return lines.join('\n');
}

function formatLamports(lamports: bigint): string {
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const whole = abs / 1_000_000_000n;
  const frac = abs % 1_000_000_000n;
  const fracStr = frac.toString().padStart(9, '0');
  return `${negative ? '-' : ''}${whole}.${fracStr}`;
}

// =========================================================================
// Main
// =========================================================================
async function main() {
  console.log('=== On-Chain Balance Verification ===\n');

  // Find the wallet
  const wallet = await prisma.wallet.findFirst({
    where: { address: 'TmYrwibiy2seJZnsi9cGvioixVsh21Q2XmVrVXy9eDH' },
  });
  if (!wallet) throw new Error('Wallet not found in DB');
  console.log(`Wallet: ${wallet.address} (id: ${wallet.id})`);

  // Step 1: Fetch all Helius enhanced transactions
  console.log('\n1. Fetching all enhanced transactions from Helius...');
  const heliusTxs = await fetchAllHeliusTxs(wallet.address);
  console.log(`   Total: ${heliusTxs.length} transactions`);

  // Save raw data (can be large — several MB)
  writeJson('onchain-raw-txs.json', heliusTxs);

  // Step 2: Deduplicate and summarize each transaction
  console.log('\n2. Deduplicating and summarizing transactions...');
  const seenSigs = new Set<string>();
  const uniqueTxs: any[] = [];
  for (const tx of heliusTxs) {
    if (!seenSigs.has(tx.signature)) {
      seenSigs.add(tx.signature);
      uniqueTxs.push(tx);
    }
  }
  console.log(`   ${heliusTxs.length} total -> ${uniqueTxs.length} unique (${heliusTxs.length - uniqueTxs.length} duplicates from Helius API)`);
  const summaries = uniqueTxs.map(tx => summarizeTx(tx, wallet.address));
  writeJson('onchain-summary.json', summaries);

  const withSolDelta = summaries.filter(s => s.solDeltaLamports !== 0);
  const withSplDelta = summaries.filter(s => s.splDeltas.length > 0);
  const noDeltas = summaries.filter(s => s.solDeltaLamports === 0 && s.splDeltas.length === 0);
  console.log(`   ${withSolDelta.length} txs with SOL delta`);
  console.log(`   ${withSplDelta.length} txs with SPL deltas`);
  console.log(`   ${noDeltas.length} txs with no deltas at all`);

  // Step 3: Fetch real-time RPC balances
  console.log('\n3. Fetching real-time RPC balances...');
  const rpcBalances = await fetchRpcBalances(wallet.address);
  console.log(`   SOL: ${rpcBalances.solBalance} (${rpcBalances.solLamports} lamports)`);
  console.log(`   Tokens: ${rpcBalances.tokens.length}`);
  for (const t of rpcBalances.tokens.filter(t => t.uiAmount > 0)) {
    console.log(`     ${t.mint.slice(0, 10)}... = ${t.uiAmount}`);
  }

  // Step 4: Load DB flows
  console.log('\n4. Loading DB flows...');
  const dbFlowMap = await loadDbFlows(wallet.id);
  console.log(`   DB has flows for ${dbFlowMap.size} distinct signatures`);

  // Step 5: Compare and generate report
  console.log('\n5. Comparing and generating report...');
  const report = compare(summaries, dbFlowMap, rpcBalances, wallet.address);
  writeTxt('onchain-verification-report.txt', report);

  console.log('\n=== Done! ===');
  console.log(`Report: scripts/audit-output/onchain-verification-report.txt`);

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Verification failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
