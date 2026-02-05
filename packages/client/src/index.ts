export { AuditSwarmClient } from './client';
export type {
  AuditSwarmConfig,
  Audit,
  AuditResult,
  AuditRequest,
  Wallet,
  Transaction,
  Attestation,
  ComplianceCheck,
  Report,
  Jurisdiction,
} from './types';

// Re-export types for convenience
export type {
  JurisdictionCode,
  AuditStatus,
  AttestationType,
  AttestationStatus,
  TransactionType,
  ComplianceStatus,
} from './types';
