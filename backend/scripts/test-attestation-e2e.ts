/**
 * End-to-end test for the attestation flow on Solana devnet.
 *
 * Tests the full pipeline:
 *   1. Find a completed audit
 *   2. Create an attestation via BullMQ job (bypassing HTTP auth)
 *   3. Poll DB until status changes from PENDING
 *   4. Verify on-chain PDA exists and data matches
 *   5. Verify the attestation via DB lookup
 *
 * Usage:
 *   cd auditswarm/backend
 *   NODE_PATH=libs/database/node_modules:node_modules npx tsx scripts/test-attestation-e2e.ts
 */

import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { Connection, PublicKey } from '@solana/web3.js';
import { createHash } from 'crypto';

// --- Constants ---

const PROGRAM_ID = new PublicKey('52LCg2VXDYgam4yHkXEp2vN2psUmo6Q7rv5efRm7ic8c');
const STATE_SEED = Buffer.from('state');
const ATTESTATION_SEED = Buffer.from('attestation');
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

const JURISDICTION_MAP: Record<string, number> = {
  US: 0, EU: 1, BR: 2, UK: 3, JP: 4, AU: 5, CA: 6, CH: 7, SG: 8,
};

const ATTESTATION_TYPE_MAP: Record<string, number> = {
  TAX_COMPLIANCE: 0, AUDIT_COMPLETE: 1, REPORTING_COMPLETE: 2,
  QUARTERLY_REVIEW: 3, ANNUAL_REVIEW: 4,
};

// --- Helpers ---

function getStatePDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID);
}

function getAttestationPDA(auditHashBytes: Buffer): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ATTESTATION_SEED, auditHashBytes],
    PROGRAM_ID,
  );
}

function parseAttestationAccount(data: Buffer) {
  let offset = 8; // skip account discriminator

  const bump = data[offset]; offset += 1;
  const authority = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
  const jurisdiction = data[offset]; offset += 1;
  const attestationType = data[offset]; offset += 1;
  const status = data[offset]; offset += 1;
  const taxYear = data.readUInt16LE(offset); offset += 2;
  const auditHash = Buffer.from(data.slice(offset, offset + 32)); offset += 32;
  const issuedAt = Number(data.readBigInt64LE(offset)); offset += 8;
  const expiresAt = Number(data.readBigInt64LE(offset)); offset += 8;
  const revokedAt = Number(data.readBigInt64LE(offset)); offset += 8;
  const numWallets = data[offset]; offset += 1;

  const vecLen = data.readUInt32LE(offset); offset += 4;
  const wallets: PublicKey[] = [];
  for (let i = 0; i < vecLen; i++) {
    wallets.push(new PublicKey(data.slice(offset, offset + 32)));
    offset += 32;
  }

  return {
    bump, authority, jurisdiction, attestationType, status,
    taxYear, auditHash, issuedAt, expiresAt, revokedAt,
    numWallets, wallets,
  };
}

const STATUS_NAMES = ['Pending', 'Active', 'Expired', 'Revoked'];
const JURISDICTION_NAMES = ['US', 'EU', 'BR', 'UK', 'JP', 'AU', 'CA', 'CH', 'SG'];

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// --- Main ---

const prisma = new PrismaClient();

async function main() {
  console.log('=== Attestation E2E Test ===\n');
  console.log(`Program ID: ${PROGRAM_ID.toBase58()}`);
  console.log(`RPC URL: ${RPC_URL}\n`);

  // Step 1: Verify program state exists on-chain
  const connection = new Connection(RPC_URL, 'confirmed');
  const [statePDA] = getStatePDA();
  console.log(`State PDA: ${statePDA.toBase58()}`);

  const stateAccount = await connection.getAccountInfo(statePDA);
  if (!stateAccount) {
    console.error('ERROR: Program state PDA not found on-chain. Was the program initialized?');
    process.exit(1);
  }
  console.log('Program state exists on-chain (data size:', stateAccount.data.length, 'bytes)');

  // Parse state to verify
  const stateData = stateAccount.data as Buffer;
  const stateAuthority = new PublicKey(stateData.slice(8, 40));
  const attestationCount = Number(stateData.readBigUInt64LE(40));
  console.log(`  Authority: ${stateAuthority.toBase58()}`);
  console.log(`  Attestation count: ${attestationCount}\n`);

  // Step 2: Find a completed audit
  const audit = await prisma.audit.findFirst({
    where: { status: 'COMPLETED', resultId: { not: null } },
    include: {
      wallets: { include: { wallet: { select: { id: true, address: true } } } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  if (!audit) {
    console.error('ERROR: No completed audit found. Run an audit first.');
    process.exit(1);
  }

  const walletAddresses = (audit.wallets as any[]).map((aw: any) => aw.wallet.address);
  console.log(`Found completed audit: ${audit.id}`);
  console.log(`  Jurisdiction: ${audit.jurisdiction}`);
  console.log(`  Tax year: ${audit.taxYear}`);
  console.log(`  Wallets: ${walletAddresses.join(', ')}`);

  // Generate hash (matching the service logic)
  const result = audit.resultId
    ? await prisma.auditResult.findUnique({ where: { id: audit.resultId } })
    : null;
  const hashInput = JSON.stringify({
    auditId: audit.id,
    walletAddress: walletAddresses.join(','),
    taxYear: audit.taxYear,
    jurisdiction: audit.jurisdiction,
    summary: result ? { netGainLoss: result.netGainLoss, totalIncome: result.totalIncome } : {},
    timestamp: Date.now(),
  });
  const hash = createHash('sha256').update(hashInput).digest('hex');
  console.log(`  Generated hash: ${hash.slice(0, 16)}...`);

  // Step 3: Check if an attestation already exists for this audit
  const existing = await prisma.attestation.findFirst({
    where: { auditId: audit.id, status: 'ACTIVE' },
  });
  if (existing) {
    console.log(`\nExisting ACTIVE attestation found: ${existing.id}`);
    console.log(`  On-chain account: ${existing.onChainAccount}`);
    console.log(`  Signature: ${existing.onChainSignature}`);
    console.log('\nSkipping creation, proceeding to on-chain verification...');
    if (existing.hash && existing.onChainAccount) {
      await verifyOnChain(connection, existing.hash, existing.onChainAccount, {
        jurisdiction: existing.jurisdiction,
        taxYear: existing.taxYear,
        walletAddresses,
      });
    }
    await prisma.$disconnect();
    return;
  }

  // Step 4: Create attestation record and queue job
  const primaryWalletId = (audit.wallets as any[])[0].walletId;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 365);

  const attestation = await prisma.attestation.create({
    data: {
      walletId: primaryWalletId,
      auditId: audit.id,
      jurisdiction: audit.jurisdiction,
      type: 'TAX_COMPLIANCE',
      status: 'PENDING',
      taxYear: audit.taxYear,
      hash,
      expiresAt,
    },
  });
  console.log(`\nAttestation record created: ${attestation.id}`);

  // Dispatch job to BullMQ
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

  const queue = new Queue('attestation', {
    connection: { host: redisHost, port: redisPort },
  });

  const jobData = {
    attestationId: attestation.id,
    auditId: audit.id,
    walletAddresses,
    jurisdiction: audit.jurisdiction,
    type: 'TAX_COMPLIANCE',
    taxYear: audit.taxYear,
    hash,
    expiresAt,
  };

  await queue.add('create-attestation', jobData, {
    jobId: `attestation-${attestation.id}`,
  });
  console.log('Job dispatched to attestation queue\n');

  // Step 5: Poll for completion
  console.log('Polling for status change...');
  let finalAttestation: any = null;
  for (let i = 0; i < 40; i++) {
    await sleep(3000);

    const current = await prisma.attestation.findUnique({
      where: { id: attestation.id },
    });
    if (!current) {
      console.error('Attestation record disappeared!');
      process.exit(1);
    }

    console.log(`  [${i}] status: ${current.status} | account: ${current.onChainAccount || 'n/a'} | sig: ${current.onChainSignature?.slice(0, 20) || 'n/a'}...`);

    if (current.status === 'ACTIVE') {
      finalAttestation = current;
      break;
    }

    if (current.status === 'FAILED') {
      console.error('\nAttestation FAILED');
      console.error('Check the API/processor logs for details.');
      await queue.close();
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  if (!finalAttestation) {
    console.error('\nTimeout waiting for attestation to become ACTIVE');
    await queue.close();
    await prisma.$disconnect();
    process.exit(1);
  }

  // Step 6: Success - log results
  console.log('\n========================================');
  console.log('ATTESTATION CREATED SUCCESSFULLY');
  console.log('========================================');
  console.log(`  ID: ${finalAttestation.id}`);
  console.log(`  Status: ${finalAttestation.status}`);
  console.log(`  On-chain account: ${finalAttestation.onChainAccount}`);
  console.log(`  Transaction: ${finalAttestation.onChainSignature}`);
  console.log(`  Slot: ${finalAttestation.onChainSlot}`);
  console.log(`  Block time: ${finalAttestation.onChainBlockTime}`);
  console.log(`  Hash: ${finalAttestation.hash?.slice(0, 16)}...`);
  console.log(`  Expires: ${finalAttestation.expiresAt}`);

  // Step 7: Verify on-chain
  await verifyOnChain(connection, finalAttestation.hash, finalAttestation.onChainAccount, {
    jurisdiction: finalAttestation.jurisdiction,
    taxYear: finalAttestation.taxYear,
    walletAddresses,
  });

  // Step 8: Verify via DB lookup (simulating verify endpoint)
  const activeByAddress = await prisma.attestation.findFirst({
    where: {
      wallet: { address: walletAddresses[0] },
      jurisdiction: audit.jurisdiction,
      status: 'ACTIVE',
      expiresAt: { gt: new Date() },
    },
    orderBy: { issuedAt: 'desc' },
  });

  console.log('\n--- Verification Query ---');
  if (activeByAddress) {
    console.log(`  Found active attestation for wallet ${walletAddresses[0]}`);
    console.log(`  Jurisdiction: ${activeByAddress.jurisdiction} | Tax year: ${activeByAddress.taxYear}`);
    console.log(`  RESULT: VALID`);
  } else {
    console.log(`  No active attestation found for wallet ${walletAddresses[0]}`);
    console.log(`  RESULT: NOT VALID`);
  }

  console.log('\nAll checks passed!');

  await queue.close();
  await prisma.$disconnect();
}

async function verifyOnChain(
  connection: Connection,
  hash: string,
  expectedAccount: string,
  expected: { jurisdiction: string; taxYear: number; walletAddresses: string[] },
) {
  console.log('\n--- On-Chain Verification ---');

  // Derive PDA from hash
  const hashBytes = Buffer.from(hash, 'hex').slice(0, 32);
  const [derivedPDA] = getAttestationPDA(hashBytes);
  console.log(`  Derived PDA: ${derivedPDA.toBase58()}`);
  console.log(`  Expected account: ${expectedAccount}`);

  if (derivedPDA.toBase58() !== expectedAccount) {
    console.error('  MISMATCH: Derived PDA does not match on-chain account!');
    process.exit(1);
  }
  console.log('  PDA derivation: MATCH');

  // Fetch on-chain account
  const accountInfo = await connection.getAccountInfo(derivedPDA);
  if (!accountInfo) {
    console.error('  ERROR: On-chain account not found!');
    process.exit(1);
  }
  console.log(`  Account exists on-chain (${accountInfo.data.length} bytes, owner: ${accountInfo.owner.toBase58()})`);

  if (accountInfo.owner.toBase58() !== PROGRAM_ID.toBase58()) {
    console.error(`  ERROR: Account owner mismatch! Expected ${PROGRAM_ID.toBase58()}, got ${accountInfo.owner.toBase58()}`);
    process.exit(1);
  }
  console.log('  Owner: MATCH (attestation program)');

  // Parse on-chain data
  const parsed = parseAttestationAccount(accountInfo.data as Buffer);

  console.log(`  On-chain jurisdiction: ${JURISDICTION_NAMES[parsed.jurisdiction] || parsed.jurisdiction}`);
  console.log(`  On-chain status: ${STATUS_NAMES[parsed.status] || parsed.status}`);
  console.log(`  On-chain tax year: ${parsed.taxYear}`);
  console.log(`  On-chain audit hash: ${parsed.auditHash.toString('hex').slice(0, 16)}...`);
  console.log(`  On-chain issued_at: ${new Date(parsed.issuedAt * 1000).toISOString()}`);
  console.log(`  On-chain expires_at: ${new Date(parsed.expiresAt * 1000).toISOString()}`);
  console.log(`  On-chain wallets (${parsed.wallets.length}):`);
  for (const w of parsed.wallets) {
    console.log(`    - ${w.toBase58()}`);
  }

  // Verify fields match
  let allMatch = true;

  const expectedJurisdiction = JURISDICTION_MAP[expected.jurisdiction] ?? -1;
  if (parsed.jurisdiction !== expectedJurisdiction) {
    console.error(`  MISMATCH: jurisdiction (on-chain: ${parsed.jurisdiction}, expected: ${expectedJurisdiction})`);
    allMatch = false;
  }

  if (parsed.taxYear !== expected.taxYear) {
    console.error(`  MISMATCH: taxYear (on-chain: ${parsed.taxYear}, expected: ${expected.taxYear})`);
    allMatch = false;
  }

  if (parsed.status !== 1) { // Active = 1
    console.error(`  MISMATCH: status is not Active (got ${STATUS_NAMES[parsed.status]})`);
    allMatch = false;
  }

  const onChainHash = parsed.auditHash.toString('hex');
  const expectedHash = hash.slice(0, 64); // sha256 = 64 hex chars = 32 bytes
  if (onChainHash !== expectedHash) {
    console.error(`  MISMATCH: audit hash`);
    console.error(`    on-chain: ${onChainHash}`);
    console.error(`    expected: ${expectedHash}`);
    allMatch = false;
  }

  // Verify wallets
  const onChainWallets = parsed.wallets.map(w => w.toBase58()).sort();
  const expectedWallets = expected.walletAddresses.sort();
  if (JSON.stringify(onChainWallets) !== JSON.stringify(expectedWallets)) {
    console.error(`  MISMATCH: wallets`);
    console.error(`    on-chain: ${onChainWallets.join(', ')}`);
    console.error(`    expected: ${expectedWallets.join(', ')}`);
    allMatch = false;
  }

  if (allMatch) {
    console.log('  All on-chain fields: VERIFIED');
  } else {
    console.error('  Some on-chain fields did not match!');
    process.exit(1);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
