import type { JurisdictionCode } from '@auditswarm/common';

export interface AuditJobData {
  auditId: string;
  userId: string;
  walletIds: string[];
  exchangeConnectionIds?: string[];
  jurisdiction: JurisdictionCode;
  taxYear: number;
  options: {
    costBasisMethod: string;
    includeStaking: boolean;
    includeAirdrops: boolean;
    includeNFTs: boolean;
    includeDeFi: boolean;
    includeFees: boolean;
    currency: string;
  };
}

export interface ReportJobData {
  auditId: string;
  resultId: string;
  format: string; // PDF, CSV, XLSX
  type: string; // Form8949, ScheduleD, etc.
  jurisdiction: JurisdictionCode;
}

export interface AttestationJobData {
  attestationId: string;
  auditId: string;
  walletAddresses: string[];
  jurisdiction: JurisdictionCode;
  type: string;
  taxYear: number;
  hash: string;
  expiresAt: Date;
}

export interface RevokeAttestationJobData {
  attestationId: string;
  hash: string;
  reason: string;
}

export interface IndexerJobData {
  walletId: string;
  walletAddress: string;
  fromSignature?: string;
  toSignature?: string;
  limit?: number;
}

export interface IndexTransactionJobData {
  walletAddress: string;
  walletId?: string;
  enrichedTransactions: unknown[];
  source: 'webhook' | 'backfill';
}

export interface SyncWalletJobData {
  walletId: string;
  walletAddress: string;
  reason: 'new_wallet' | 'reclassify' | 'manual';
  targetWalletIds?: string[];
}

export interface RegisterWebhookJobData {
  walletId: string;
  walletAddress: string;
  action: 'add' | 'remove';
}

export interface NotificationJobData {
  type: 'email' | 'webhook';
  to: string;
  subject?: string;
  template?: string;
  data: Record<string, unknown>;
}

export interface DetectFundingSourceJobData {
  walletId: string;
  walletAddress: string;
  userId: string;
}

export interface ClassifyTransactionsJobData {
  walletId: string;
  walletAddress: string;
  userId: string;
}

export interface RecalculateTaxLotsJobData {
  userId: string;
  taxYear?: number;
  triggerWalletId: string;
}

export interface AnalyzeCounterpartiesJobData {
  userId: string;
  walletId: string;
  counterpartyIds: string[];
}

export interface ProcessExchangeImportJobData {
  importId: string;
  userId: string;
  exchangeName: string;
  fileUrl: string;
}

export interface SyncExchangeConnectionJobData {
  connectionId: string;
  userId: string;
  exchangeName: string;
  fullSync?: boolean; // false = incremental from cursor
}

export interface SyncExchangePhaseJobData {
  connectionId: string;
  userId: string;
  phase: 1 | 2 | 3 | 4;
  fullSync: boolean;
}

export interface ReconcileExchangeJobData {
  importId: string;
  userId: string;
}

export interface JobProgress {
  current: number;
  total: number;
  message?: string;
}
