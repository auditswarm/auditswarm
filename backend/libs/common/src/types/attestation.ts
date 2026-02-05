import { z } from 'zod';
import { JurisdictionCode } from './jurisdiction';

export const AttestationStatus = z.enum([
  'PENDING',
  'ACTIVE',
  'EXPIRED',
  'REVOKED',
]);
export type AttestationStatus = z.infer<typeof AttestationStatus>;

export const AttestationType = z.enum([
  'TAX_COMPLIANCE',
  'AUDIT_COMPLETE',
  'REPORTING_COMPLETE',
  'QUARTERLY_REVIEW',
  'ANNUAL_REVIEW',
]);
export type AttestationType = z.infer<typeof AttestationType>;

export interface Attestation {
  id: string;
  walletAddress: string;
  jurisdiction: JurisdictionCode;
  type: AttestationType;
  status: AttestationStatus;
  taxYear: number;
  auditId: string;

  // On-chain data
  onChain: {
    account: string; // PDA address
    signature: string; // Creation transaction
    slot: number;
    blockTime: number;
  };

  // Metadata
  issuedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revokeReason?: string;

  // Verification
  hash: string; // Hash of audit result
  verificationUrl: string;
}

export interface AttestationCreateInput {
  walletAddress: string;
  jurisdiction: JurisdictionCode;
  type: AttestationType;
  taxYear: number;
  auditId: string;
  expiresAt: Date;
  hash: string;
}

export interface AttestationVerification {
  valid: boolean;
  attestation?: Attestation;
  errors?: string[];
  verifiedAt: Date;
}

// On-chain account structure
export interface AttestationAccount {
  bump: number;
  authority: string;
  wallet: string;
  jurisdiction: number; // enum index
  attestationType: number; // enum index
  status: number; // enum index
  taxYear: number;
  auditHash: Uint8Array; // 32 bytes
  issuedAt: bigint;
  expiresAt: bigint;
  revokedAt: bigint;
}

export const AttestationSchema = z.object({
  walletAddress: z.string(),
  jurisdiction: JurisdictionCode,
  type: AttestationType,
  taxYear: z.number().int().min(2000).max(2100),
  auditId: z.string().uuid(),
  expiresAt: z.date(),
  hash: z.string().length(64),
});
