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
  monthlyBreakdown?: MonthlyBreakdown;

  // US-specific
  scheduleDSummary?: ScheduleDSummary;
  fbarReport?: FBARReport;
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

/**
 * Form 8949 Box categories for digital assets (2025+).
 * Short-term: G (1099-DA basis reported), H (not reported), I (no 1099-DA)
 * Long-term:  J (1099-DA basis reported), K (not reported), L (no 1099-DA)
 */
export type Form8949Box = 'G' | 'H' | 'I' | 'J' | 'K' | 'L';

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

  // Form 8949 fields (US)
  description?: string;        // Full description: "1.5 SOL (Solana)"
  form8949Box?: Form8949Box;   // Which box on Form 8949
  adjustmentCode?: string;     // Column (f): B, E, M, etc.
  adjustmentAmount?: number;   // Column (g)
  exchangeSource?: string;     // Exchange name (for 1099-DA tracking)
  unitsDisposed?: number;      // Exact units sold
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

export interface MonthlyBreakdownEntry {
  month: number;           // 0-11
  label: string;           // e.g. "Jan", "Fev"
  salesVolume: number;     // total disposal proceeds in local currency
  capitalGains: number;    // net gains in local currency
  exempt: boolean;         // true if salesVolume <= threshold
  taxableGains: number;    // 0 if exempt, otherwise capitalGains
  threshold: number;       // exemption threshold in local currency
}

export interface MonthlyBreakdown {
  entries: MonthlyBreakdownEntry[];
  currency: string;
  totalExemptGains: number;
  totalTaxableGains: number;
  exemptMonths: number;
  taxableMonths: number;
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

// ─── US-Specific Types ───

/** Schedule D summary with capital loss cap */
export interface ScheduleDSummary {
  // Part I totals
  shortTermProceeds: number;
  shortTermCostBasis: number;
  shortTermGainLoss: number;
  // Part II totals
  longTermProceeds: number;
  longTermCostBasis: number;
  longTermGainLoss: number;
  // Part III
  totalNetGainLoss: number;
  /** Losses capped at -$3,000 ($-1,500 MFS) */
  capitalLossDeduction: number;
  /** Losses exceeding the cap — carry to next year */
  capitalLossCarryforward: number;
  /** NIIT 3.8% applicable amount (income > $200K threshold) */
  niitAmount: number;
}

/** FBAR foreign account entry */
export interface FBARAccount {
  exchangeName: string;
  exchangeCountry: string;
  accountIdentifier: string;   // user ID / account email
  /** Peak USD balance at any point during the year */
  peakBalance: number;
  peakBalanceDate?: Date;
  isForeignExchange: boolean;
}

/** FBAR / FATCA compliance report */
export interface FBARReport {
  accounts: FBARAccount[];
  aggregatePeakValue: number;
  fbarRequired: boolean;        // aggregate > $10K
  fatcaRequired: boolean;       // aggregate > $50K (single resident)
  fbarThreshold: number;
  fatcaThreshold: number;
}

/** Form 8938 (FATCA) thresholds by filing status */
export interface FATCAThresholds {
  yearEnd: number;
  anyTime: number;
}
