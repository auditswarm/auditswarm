import { PublicKey, Connection, TransactionInstruction } from '@solana/web3.js';
import { Program, AnchorProvider, Idl, BN } from '@coral-xyz/anchor';

// Program ID - update after deployment
export const PROGRAM_ID = new PublicKey('Attest1111111111111111111111111111111111111');

// Seeds
export const STATE_SEED = Buffer.from('state');
export const ATTESTATION_SEED = Buffer.from('attestation');

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
  wallet: PublicKey;
  jurisdiction: Jurisdiction;
  attestationType: AttestationType;
  status: AttestationStatus;
  taxYear: number;
  auditHash: Uint8Array;
  issuedAt: bigint;
  expiresAt: bigint;
  revokedAt: bigint;
}

export interface ProgramStateData {
  authority: PublicKey;
  attestationCount: bigint;
  bump: number;
}

/**
 * Get the PDA for program state
 */
export function getStatePDA(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([STATE_SEED], programId);
}

/**
 * Get the PDA for an attestation
 */
export function getAttestationPDA(
  wallet: PublicKey,
  jurisdiction: Jurisdiction,
  attestationType: AttestationType,
  taxYear: number,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  const taxYearBuffer = Buffer.alloc(2);
  taxYearBuffer.writeUInt16LE(taxYear);

  return PublicKey.findProgramAddressSync(
    [
      ATTESTATION_SEED,
      wallet.toBuffer(),
      Buffer.from([jurisdiction]),
      Buffer.from([attestationType]),
      taxYearBuffer,
    ],
    programId,
  );
}

/**
 * AuditSwarm Attestation SDK
 */
export class AuditSwarmSolana {
  private connection: Connection;
  private programId: PublicKey;

  constructor(connection: Connection, programId: PublicKey = PROGRAM_ID) {
    this.connection = connection;
    this.programId = programId;
  }

  /**
   * Get the program state
   */
  async getState(): Promise<ProgramStateData | null> {
    const [statePDA] = getStatePDA(this.programId);

    try {
      const accountInfo = await this.connection.getAccountInfo(statePDA);
      if (!accountInfo) return null;

      // Parse account data (skip 8-byte discriminator)
      const data = accountInfo.data.slice(8);
      return {
        authority: new PublicKey(data.slice(0, 32)),
        attestationCount: data.readBigUInt64LE(32),
        bump: data[40],
      };
    } catch {
      return null;
    }
  }

  /**
   * Get an attestation by its PDA
   */
  async getAttestation(
    wallet: PublicKey,
    jurisdiction: Jurisdiction,
    attestationType: AttestationType,
    taxYear: number,
  ): Promise<AttestationData | null> {
    const [attestationPDA] = getAttestationPDA(
      wallet,
      jurisdiction,
      attestationType,
      taxYear,
      this.programId,
    );

    return this.getAttestationByAddress(attestationPDA);
  }

  /**
   * Get an attestation by address
   */
  async getAttestationByAddress(address: PublicKey): Promise<AttestationData | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(address);
      if (!accountInfo) return null;

      // Parse account data (skip 8-byte discriminator)
      const data = accountInfo.data.slice(8);

      return {
        bump: data[0],
        authority: new PublicKey(data.slice(1, 33)),
        wallet: new PublicKey(data.slice(33, 65)),
        jurisdiction: data[65] as Jurisdiction,
        attestationType: data[66] as AttestationType,
        status: data[67] as AttestationStatus,
        taxYear: data.readUInt16LE(68),
        auditHash: new Uint8Array(data.slice(70, 102)),
        issuedAt: data.readBigInt64LE(102),
        expiresAt: data.readBigInt64LE(110),
        revokedAt: data.readBigInt64LE(118),
      };
    } catch {
      return null;
    }
  }

  /**
   * Get all attestations for a wallet
   */
  async getWalletAttestations(wallet: PublicKey): Promise<AttestationData[]> {
    // Get all program accounts that match the attestation discriminator
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        {
          memcmp: {
            offset: 33, // Skip discriminator (8) + bump (1) + authority (32)
            bytes: wallet.toBase58(),
          },
        },
      ],
    });

    const attestations: AttestationData[] = [];

    for (const { pubkey, account } of accounts) {
      const attestation = await this.getAttestationByAddress(pubkey);
      if (attestation) {
        attestations.push(attestation);
      }
    }

    return attestations;
  }

  /**
   * Check if a wallet is compliant for a jurisdiction
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

    // Check for TaxCompliance attestation
    const attestation = await this.getAttestation(
      wallet,
      jurisdiction,
      AttestationType.TaxCompliance,
      year,
    );

    if (!attestation) {
      return {
        compliant: false,
        reason: 'No attestation found',
      };
    }

    if (attestation.status !== AttestationStatus.Active) {
      return {
        compliant: false,
        attestation,
        reason: `Attestation status is ${AttestationStatus[attestation.status]}`,
      };
    }

    const now = BigInt(Math.floor(Date.now() / 1000));
    if (attestation.expiresAt < now) {
      return {
        compliant: false,
        attestation,
        reason: 'Attestation has expired',
      };
    }

    return {
      compliant: true,
      attestation,
    };
  }

  /**
   * Verify an attestation hash
   */
  async verifyAttestation(
    wallet: PublicKey,
    jurisdiction: Jurisdiction,
    attestationType: AttestationType,
    taxYear: number,
    expectedHash: Uint8Array,
  ): Promise<boolean> {
    const attestation = await this.getAttestation(
      wallet,
      jurisdiction,
      attestationType,
      taxYear,
    );

    if (!attestation) return false;
    if (attestation.status !== AttestationStatus.Active) return false;

    // Compare hashes
    if (attestation.auditHash.length !== expectedHash.length) return false;

    for (let i = 0; i < attestation.auditHash.length; i++) {
      if (attestation.auditHash[i] !== expectedHash[i]) return false;
    }

    return true;
  }
}

export default AuditSwarmSolana;
