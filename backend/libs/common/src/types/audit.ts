import { z } from 'zod';
import { JurisdictionCode } from './jurisdiction';

export const AuditStatus = z.enum([
  'PENDING',
  'QUEUED',
  'PROCESSING',
  'ANALYZING',
  'GENERATING_REPORT',
  'COMPLETED',
  'FAILED',
]);
export type AuditStatus = z.infer<typeof AuditStatus>;

export const AuditType = z.enum([
  'FULL_TAX_YEAR',
  'QUARTERLY',
  'SINGLE_WALLET',
  'MULTI_WALLET',
  'DEFI_POSITIONS',
  'NFT_PORTFOLIO',
  'CUSTOM_PERIOD',
]);
export type AuditType = z.infer<typeof AuditType>;

export interface AuditRequest {
  id: string;
  userId: string;
  walletIds: string[];
  jurisdiction: JurisdictionCode;
  type: AuditType;
  taxYear: number;
  period?: {
    start: Date;
    end: Date;
  };
  options: AuditOptions;
  status: AuditStatus;
  progress: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  resultId?: string;
}

export interface AuditOptions {
  costBasisMethod: 'FIFO' | 'LIFO' | 'HIFO' | 'SPECIFIC_ID' | 'AVERAGE';
  includeStaking: boolean;
  includeAirdrops: boolean;
  includeNFTs: boolean;
  includeDeFi: boolean;
  includeFees: boolean;
  currency: string;
}

export interface AuditResult {
  id: string;
  auditId: string;
  jurisdiction: JurisdictionCode;
  taxYear: number;
  summary: AuditSummary;
  capitalGains: CapitalGainsReport;
  income: IncomeReport;
  holdings: HoldingsReport;
  issues: AuditIssue[];
  recommendations: string[];
  metadata: AuditMetadata;
}

export interface AuditSummary {
  totalTransactions: number;
  totalWallets: number;
  periodStart: Date;
  periodEnd: Date;
  netGainLoss: number;
  totalIncome: number;
  estimatedTax: number;
  currency: string;
}

export interface CapitalGainsReport {
  shortTermGains: number;
  shortTermLosses: number;
  longTermGains: number;
  longTermLosses: number;
  netShortTerm: number;
  netLongTerm: number;
  totalNet: number;
  transactions: CapitalGainTransaction[];
}

export interface CapitalGainTransaction {
  id: string;
  asset: string;
  dateAcquired: Date;
  dateSold: Date;
  proceeds: number;
  costBasis: number;
  gainLoss: number;
  type: 'SHORT_TERM' | 'LONG_TERM';
  transactionSignature?: string;
}

export interface IncomeReport {
  staking: number;
  mining: number;
  airdrops: number;
  rewards: number;
  other: number;
  total: number;
  events: IncomeEvent[];
}

export interface IncomeEvent {
  id: string;
  type: string;
  asset: string;
  amount: number;
  valueUsd: number;
  date: Date;
  transactionSignature?: string;
}

export interface HoldingsReport {
  totalValueUsd: number;
  assets: AssetHolding[];
  asOf: Date;
}

export interface AssetHolding {
  mint: string;
  symbol: string;
  balance: number;
  valueUsd: number;
  costBasis: number;
  unrealizedGainLoss: number;
}

export interface AuditIssue {
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  type: string;
  description: string;
  transaction?: string;
  recommendation: string;
}

export interface AuditMetadata {
  version: string;
  beeVersion: string;
  jurisdiction: JurisdictionCode;
  costBasisMethod: string;
  dataSource: string;
  processedAt: Date;
  processingTime: number;
}
