export { AuditSwarmProvider, useAuditSwarm } from './provider';
export { useAudit } from './hooks/useAudit';
export { useCompliance } from './hooks/useCompliance';
export { useAttestation } from './hooks/useAttestation';
export { useWallets } from './hooks/useWallets';

// Re-export types from client
export type {
  Audit,
  AuditResult,
  AuditRequest,
  Wallet,
  Transaction,
  Attestation,
  ComplianceCheck,
  Report,
  Jurisdiction,
  JurisdictionCode,
} from '@auditswarm.xyz/client';
