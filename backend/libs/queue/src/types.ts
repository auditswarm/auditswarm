import type { JurisdictionCode } from '@auditswarm/common';

export interface AuditJobData {
  auditId: string;
  userId: string;
  walletIds: string[];
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
  walletAddress: string;
  jurisdiction: JurisdictionCode;
  type: string;
  taxYear: number;
  hash: string;
  expiresAt: Date;
}

export interface IndexerJobData {
  walletId: string;
  walletAddress: string;
  fromSignature?: string;
  toSignature?: string;
  limit?: number;
}

export interface NotificationJobData {
  type: 'email' | 'webhook';
  to: string;
  subject?: string;
  template?: string;
  data: Record<string, unknown>;
}

export interface JobProgress {
  current: number;
  total: number;
  message?: string;
}
