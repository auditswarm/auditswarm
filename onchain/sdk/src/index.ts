import {
  PublicKey,
  Connection,
  TransactionInstruction,
  SystemProgram,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
// @coral-xyz/anchor available as peer dep but not directly used for instruction building
// due to IDL format incompatibility with anchor 0.29 (program uses 0.30+ IDL spec)

// Program ID
export const PROGRAM_ID = new PublicKey('52LCg2VXDYgam4yHkXEp2vN2psUmo6Q7rv5efRm7ic8c');

// Seeds
export const STATE_SEED = Buffer.from('state');
export const ATTESTATION_SEED = Buffer.from('attestation');

// Instruction discriminators (from IDL)
const DISCRIMINATORS = {
  initialize: Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]),
  createAttestation: Buffer.from([49, 24, 67, 80, 12, 249, 96, 239]),
  updateStatus: Buffer.from([147, 215, 74, 174, 55, 191, 42, 0]),
  revokeAttestation: Buffer.from([12, 156, 103, 161, 194, 246, 211, 179]),
};

// Account discriminators (from IDL)
const ACCOUNT_DISCRIMINATORS = {
  attestation: Buffer.from([152, 125, 183, 86, 36, 146, 121, 73]),
  programState: Buffer.from([77, 209, 137, 229, 149, 67, 167, 230]),
};

// Enums
export enum Jurisdiction {
  US = 0,
  EU = 1,
  BR = 2,
  UK = 3,
  JP = 4,
  AU = 5,
  CA = 6,
  CH = 7,
  SG = 8,
}

export enum AttestationType {
  TaxCompliance = 0,
  AuditComplete = 1,
  ReportingComplete = 2,
  QuarterlyReview = 3,
  AnnualReview = 4,
}

export enum AttestationStatus {
  Pending = 0,
  Active = 1,
  Expired = 2,
  Revoked = 3,
}

// Interfaces
export interface AttestationData {
  bump: number;
  authority: PublicKey;
  jurisdiction: Jurisdiction;
  attestationType: AttestationType;
  status: AttestationStatus;
  taxYear: number;
  auditHash: Uint8Array;
  issuedAt: bigint;
  expiresAt: bigint;
  revokedAt: bigint;
  numWallets: number;
  wallets: PublicKey[];
}

export interface ProgramStateData {
  authority: PublicKey;
  attestationCount: bigint;
  bump: number;
}

export interface CreateAttestationParams {
  authority: Keypair;
  jurisdiction: Jurisdiction;
  attestationType: AttestationType;
  taxYear: number;
  auditHash: Buffer;
  expiresAt: number;
  wallets: PublicKey[];
}

export interface UpdateStatusParams {
  authority: Keypair;
  auditHash: Buffer;
  newStatus: AttestationStatus;
}

export interface RevokeAttestationParams {
  authority: Keypair;
  auditHash: Buffer;
}

/**
 * Get the PDA for program state
 */
export function getStatePDA(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([STATE_SEED], programId);
}

/**
 * Get the PDA for an attestation by audit hash.
 * Seeds: ["attestation", auditHash] where auditHash is 32 bytes.
 */
export function getAttestationPDA(
  auditHash: Buffer,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ATTESTATION_SEED, auditHash],
    programId,
  );
}

// -- Serialization helpers --

function serializeEnum(value: number): Buffer {
  // Anchor enums are serialized as a single byte index
  return Buffer.from([value]);
}

function serializeU16LE(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value);
  return buf;
}

function serializeI64LE(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(value));
  return buf;
}

function serializeVecPubkey(keys: PublicKey[]): Buffer {
  // Vec<Pubkey>: 4-byte LE length prefix + concatenated 32-byte keys
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(keys.length);
  return Buffer.concat([lenBuf, ...keys.map((k) => k.toBuffer())]);
}

// -- Account parsing helpers --

function parseAttestationData(data: Buffer): AttestationData {
  // Skip 8-byte account discriminator
  let offset = 8;

  const bump = data[offset];
  offset += 1;

  const authority = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const jurisdiction = data[offset] as Jurisdiction;
  offset += 1;

  const attestationType = data[offset] as AttestationType;
  offset += 1;

  const status = data[offset] as AttestationStatus;
  offset += 1;

  const taxYear = data.readUInt16LE(offset);
  offset += 2;

  const auditHash = new Uint8Array(data.slice(offset, offset + 32));
  offset += 32;

  const issuedAt = data.readBigInt64LE(offset);
  offset += 8;

  const expiresAt = data.readBigInt64LE(offset);
  offset += 8;

  const revokedAt = data.readBigInt64LE(offset);
  offset += 8;

  const numWallets = data[offset];
  offset += 1;

  // Vec<Pubkey>: 4-byte LE length + N * 32 bytes
  const vecLen = data.readUInt32LE(offset);
  offset += 4;

  const wallets: PublicKey[] = [];
  for (let i = 0; i < vecLen; i++) {
    wallets.push(new PublicKey(data.slice(offset, offset + 32)));
    offset += 32;
  }

  return {
    bump,
    authority,
    jurisdiction,
    attestationType,
    status,
    taxYear,
    auditHash,
    issuedAt,
    expiresAt,
    revokedAt,
    numWallets,
    wallets,
  };
}

function parseProgramStateData(data: Buffer): ProgramStateData {
  // Skip 8-byte account discriminator
  let offset = 8;

  const authority = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const attestationCount = data.readBigUInt64LE(offset);
  offset += 8;

  const bump = data[offset];

  return { authority, attestationCount, bump };
}

/**
 * AuditSwarm Attestation SDK
 *
 * Provides read and write operations for the on-chain attestation program.
 * Write operations build and send transactions using the provided keypair.
 * Read operations only require a Connection.
 */
export class AuditSwarmSolana {
  private connection: Connection;
  private programId: PublicKey;

  constructor(connection: Connection, programId: PublicKey = PROGRAM_ID) {
    this.connection = connection;
    this.programId = programId;
  }

  // ===================
  // Write Operations
  // ===================

  /**
   * Initialize the program state. Must be called once by the authority.
   * Returns the transaction signature.
   */
  async initialize(authority: Keypair): Promise<string> {
    const [statePDA] = getStatePDA(this.programId);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: statePDA, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: DISCRIMINATORS.initialize,
    });

    const tx = new Transaction().add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [authority]);
  }

  /**
   * Create a new attestation covering multiple wallets.
   * Returns the transaction signature.
   */
  async createAttestation(params: CreateAttestationParams): Promise<string> {
    const { authority, jurisdiction, attestationType, taxYear, auditHash, expiresAt, wallets } = params;

    if (auditHash.length !== 32) {
      throw new Error('auditHash must be exactly 32 bytes');
    }
    if (wallets.length < 1 || wallets.length > 10) {
      throw new Error('wallets must contain 1-10 entries');
    }

    const [statePDA] = getStatePDA(this.programId);
    const [attestationPDA] = getAttestationPDA(auditHash, this.programId);

    // Serialize instruction data:
    // discriminator(8) + jurisdiction(1) + attestation_type(1) + tax_year(2) + audit_hash(32) + expires_at(8) + wallets(4 + N*32)
    const instructionData = Buffer.concat([
      DISCRIMINATORS.createAttestation,
      serializeEnum(jurisdiction),
      serializeEnum(attestationType),
      serializeU16LE(taxYear),
      auditHash,
      serializeI64LE(expiresAt),
      serializeVecPubkey(wallets),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: statePDA, isSigner: false, isWritable: true },
        { pubkey: attestationPDA, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });

    const tx = new Transaction().add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [authority]);
  }

  /**
   * Update the status of an existing attestation.
   * Returns the transaction signature.
   */
  async updateStatus(params: UpdateStatusParams): Promise<string> {
    const { authority, auditHash, newStatus } = params;

    if (auditHash.length !== 32) {
      throw new Error('auditHash must be exactly 32 bytes');
    }

    const [statePDA] = getStatePDA(this.programId);
    const [attestationPDA] = getAttestationPDA(auditHash, this.programId);

    const instructionData = Buffer.concat([
      DISCRIMINATORS.updateStatus,
      serializeEnum(newStatus),
    ]);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: statePDA, isSigner: false, isWritable: false },
        { pubkey: attestationPDA, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      ],
      data: instructionData,
    });

    const tx = new Transaction().add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [authority]);
  }

  /**
   * Revoke an attestation.
   * Returns the transaction signature.
   */
  async revokeAttestation(params: RevokeAttestationParams): Promise<string> {
    const { authority, auditHash } = params;

    if (auditHash.length !== 32) {
      throw new Error('auditHash must be exactly 32 bytes');
    }

    const [statePDA] = getStatePDA(this.programId);
    const [attestationPDA] = getAttestationPDA(auditHash, this.programId);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: statePDA, isSigner: false, isWritable: false },
        { pubkey: attestationPDA, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      ],
      data: DISCRIMINATORS.revokeAttestation,
    });

    const tx = new Transaction().add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [authority]);
  }

  // ==========================
  // Instruction Builders
  // ==========================

  /**
   * Build an initialize instruction without sending.
   * Useful for composing with other instructions in a single transaction.
   */
  buildInitializeInstruction(authority: PublicKey): TransactionInstruction {
    const [statePDA] = getStatePDA(this.programId);

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: statePDA, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: DISCRIMINATORS.initialize,
    });
  }

  /**
   * Build a createAttestation instruction without sending.
   */
  buildCreateAttestationInstruction(
    authority: PublicKey,
    params: Omit<CreateAttestationParams, 'authority'> & { authority?: never },
  ): TransactionInstruction {
    const { jurisdiction, attestationType, taxYear, auditHash, expiresAt, wallets } = params;

    if (auditHash.length !== 32) {
      throw new Error('auditHash must be exactly 32 bytes');
    }
    if (wallets.length < 1 || wallets.length > 10) {
      throw new Error('wallets must contain 1-10 entries');
    }

    const [statePDA] = getStatePDA(this.programId);
    const [attestationPDA] = getAttestationPDA(auditHash, this.programId);

    const instructionData = Buffer.concat([
      DISCRIMINATORS.createAttestation,
      serializeEnum(jurisdiction),
      serializeEnum(attestationType),
      serializeU16LE(taxYear),
      auditHash,
      serializeI64LE(expiresAt),
      serializeVecPubkey(wallets),
    ]);

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: statePDA, isSigner: false, isWritable: true },
        { pubkey: attestationPDA, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: instructionData,
    });
  }

  /**
   * Build an updateStatus instruction without sending.
   */
  buildUpdateStatusInstruction(
    authority: PublicKey,
    auditHash: Buffer,
    newStatus: AttestationStatus,
  ): TransactionInstruction {
    if (auditHash.length !== 32) {
      throw new Error('auditHash must be exactly 32 bytes');
    }

    const [statePDA] = getStatePDA(this.programId);
    const [attestationPDA] = getAttestationPDA(auditHash, this.programId);

    const instructionData = Buffer.concat([
      DISCRIMINATORS.updateStatus,
      serializeEnum(newStatus),
    ]);

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: statePDA, isSigner: false, isWritable: false },
        { pubkey: attestationPDA, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: false },
      ],
      data: instructionData,
    });
  }

  /**
   * Build a revokeAttestation instruction without sending.
   */
  buildRevokeAttestationInstruction(
    authority: PublicKey,
    auditHash: Buffer,
  ): TransactionInstruction {
    if (auditHash.length !== 32) {
      throw new Error('auditHash must be exactly 32 bytes');
    }

    const [statePDA] = getStatePDA(this.programId);
    const [attestationPDA] = getAttestationPDA(auditHash, this.programId);

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: statePDA, isSigner: false, isWritable: false },
        { pubkey: attestationPDA, isSigner: false, isWritable: true },
        { pubkey: authority, isSigner: true, isWritable: false },
      ],
      data: DISCRIMINATORS.revokeAttestation,
    });
  }

  // ===================
  // Read Operations
  // ===================

  /**
   * Get the program state.
   */
  async getState(): Promise<ProgramStateData | null> {
    const [statePDA] = getStatePDA(this.programId);

    try {
      const accountInfo = await this.connection.getAccountInfo(statePDA);
      if (!accountInfo) return null;
      return parseProgramStateData(accountInfo.data as Buffer);
    } catch {
      return null;
    }
  }

  /**
   * Get an attestation by its audit hash (derives PDA from hash).
   */
  async getAttestation(auditHash: Buffer): Promise<AttestationData | null> {
    if (auditHash.length !== 32) {
      throw new Error('auditHash must be exactly 32 bytes');
    }

    const [attestationPDA] = getAttestationPDA(auditHash, this.programId);
    return this.getAttestationByAddress(attestationPDA);
  }

  /**
   * Get an attestation by its on-chain account address.
   */
  async getAttestationByAddress(address: PublicKey): Promise<AttestationData | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(address);
      if (!accountInfo) return null;
      return parseAttestationData(accountInfo.data as Buffer);
    } catch {
      return null;
    }
  }

  /**
   * Get all attestations that include the given wallet.
   * Fetches all program attestation accounts and filters client-side.
   */
  async getWalletAttestations(wallet: PublicKey): Promise<AttestationData[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: Buffer.from(ACCOUNT_DISCRIMINATORS.attestation).toString('base64'),
            encoding: 'base64' as any,
          },
        },
      ],
    });

    const attestations: AttestationData[] = [];

    for (const { account } of accounts) {
      try {
        const attestation = parseAttestationData(account.data as Buffer);
        // Check if any wallet in the attestation matches the queried wallet
        const hasWallet = attestation.wallets.some((w) => w.equals(wallet));
        if (hasWallet) {
          attestations.push(attestation);
        }
      } catch {
        // Skip malformed accounts
      }
    }

    return attestations;
  }

  /**
   * Check if a wallet is compliant for a given jurisdiction and optional tax year.
   * Searches all attestations that include the wallet and checks for an active,
   * non-expired TaxCompliance attestation.
   */
  async isCompliant(
    wallet: PublicKey,
    jurisdiction: Jurisdiction,
    taxYear?: number,
  ): Promise<{
    compliant: boolean;
    attestation?: AttestationData;
    reason?: string;
  }> {
    const year = taxYear || new Date().getFullYear();
    const attestations = await this.getWalletAttestations(wallet);

    // Find matching TaxCompliance attestation for the jurisdiction and year
    const matching = attestations.find(
      (a) =>
        a.jurisdiction === jurisdiction &&
        a.attestationType === AttestationType.TaxCompliance &&
        a.taxYear === year,
    );

    if (!matching) {
      return {
        compliant: false,
        reason: 'No attestation found',
      };
    }

    if (matching.status !== AttestationStatus.Active) {
      return {
        compliant: false,
        attestation: matching,
        reason: `Attestation status is ${AttestationStatus[matching.status]}`,
      };
    }

    const now = BigInt(Math.floor(Date.now() / 1000));
    if (matching.expiresAt < now) {
      return {
        compliant: false,
        attestation: matching,
        reason: 'Attestation has expired',
      };
    }

    return {
      compliant: true,
      attestation: matching,
    };
  }

  /**
   * Verify that an attestation's on-chain hash matches the expected hash.
   */
  async verifyAttestation(
    auditHash: Buffer,
    expectedHash: Uint8Array,
  ): Promise<boolean> {
    const attestation = await this.getAttestation(auditHash);

    if (!attestation) return false;
    if (attestation.status !== AttestationStatus.Active) return false;

    if (attestation.auditHash.length !== expectedHash.length) return false;

    for (let i = 0; i < attestation.auditHash.length; i++) {
      if (attestation.auditHash[i] !== expectedHash[i]) return false;
    }

    return true;
  }
}

export default AuditSwarmSolana;
