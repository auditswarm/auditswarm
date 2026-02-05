export type JurisdictionCode = 'US' | 'EU' | 'BR' | 'UK' | 'JP' | 'AU' | 'CA' | 'CH' | 'SG';

export type AuditStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'PROCESSING'
  | 'ANALYZING'
  | 'GENERATING_REPORT'
  | 'COMPLETED'
  | 'FAILED';

export type AttestationType =
  | 'TAX_COMPLIANCE'
  | 'AUDIT_COMPLETE'
  | 'REPORTING_COMPLETE'
  | 'QUARTERLY_REVIEW'
  | 'ANNUAL_REVIEW';

export type AttestationStatus = 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export type TransactionType =
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'SWAP'
  | 'BUY'
  | 'SELL'
  | 'MINT'
  | 'BURN'
  | 'STAKE'
  | 'UNSTAKE'
  | 'REWARD'
  | 'AIRDROP'
  | 'NFT_PURCHASE'
  | 'NFT_SALE'
  | 'FEE'
  | 'UNKNOWN';

export type ComplianceStatus = 'COMPLIANT' | 'NON_COMPLIANT' | 'NEEDS_REVIEW' | 'UNKNOWN';

export type CostBasisMethod = 'FIFO' | 'LIFO' | 'HIFO' | 'SPECIFIC_ID' | 'AVERAGE';

export interface AuditSwarmConfig {
  apiUrl: string;
  apiKey?: string;
}

export interface Wallet {
  id: string;
  address: string;
  network: string;
  label?: string;
  isActive: boolean;
  transactionCount: number;
  createdAt: Date;
}

export interface Transaction {
  id: string;
  walletId: string;
  signature: string;
  type: TransactionType;
  status: string;
  timestamp: Date;
  fee: string;
  totalValueUsd?: number;
  transfers: Array<{
    mint: string;
    symbol?: string;
    amount: string;
    direction: 'IN' | 'OUT';
    valueUsd?: number;
  }>;
}

export interface AuditRequest {
  walletIds: string[];
  jurisdiction: JurisdictionCode;
  type: string;
  taxYear: number;
  periodStart?: Date;
  periodEnd?: Date;
  options?: {
    costBasisMethod?: CostBasisMethod;
    includeStaking?: boolean;
    includeAirdrops?: boolean;
    includeNFTs?: boolean;
    includeDeFi?: boolean;
    includeFees?: boolean;
    currency?: string;
  };
}

export interface Audit {
  id: string;
  userId: string;
  jurisdiction: JurisdictionCode;
  type: string;
  taxYear: number;
  status: AuditStatus;
  progress: number;
  statusMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  resultId?: string;
}

export interface AuditResult {
  id: string;
  auditId: string;
  jurisdiction: JurisdictionCode;
  taxYear: number;
  summary: {
    totalTransactions: number;
    totalWallets: number;
    periodStart: Date;
    periodEnd: Date;
    netGainLoss: number;
    totalIncome: number;
    estimatedTax: number;
    currency: string;
  };
  capitalGains: {
    shortTermGains: number;
    shortTermLosses: number;
    longTermGains: number;
    longTermLosses: number;
    netShortTerm: number;
    netLongTerm: number;
    totalNet: number;
    transactions: Array<{
      id: string;
      asset: string;
      dateAcquired: Date;
      dateSold: Date;
      proceeds: number;
      costBasis: number;
      gainLoss: number;
      type: 'SHORT_TERM' | 'LONG_TERM';
    }>;
  };
  income: {
    staking: number;
    mining: number;
    airdrops: number;
    rewards: number;
    other: number;
    total: number;
  };
  holdings: {
    totalValueUsd: number;
    assets: Array<{
      mint: string;
      symbol: string;
      balance: number;
      valueUsd: number;
      costBasis: number;
      unrealizedGainLoss: number;
    }>;
  };
  issues: Array<{
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    type: string;
    description: string;
    recommendation: string;
  }>;
  recommendations: string[];
}

export interface Attestation {
  id: string;
  walletId: string;
  auditId: string;
  jurisdiction: JurisdictionCode;
  type: AttestationType;
  status: AttestationStatus;
  taxYear: number;
  onChainAccount?: string;
  onChainSignature?: string;
  hash?: string;
  issuedAt?: Date;
  expiresAt?: Date;
  revokedAt?: Date;
}

export interface ComplianceCheck {
  walletAddress: string;
  jurisdiction: JurisdictionCode;
  status: ComplianceStatus;
  score: number;
  summary: string;
  hasAttestation: boolean;
  attestationExpiry?: Date;
  lastAuditDate?: Date;
  recommendedActions: string[];
}

export interface Report {
  id: string;
  auditId: string;
  type: 'PDF' | 'CSV' | 'XLSX' | 'JSON';
  format: string;
  fileName: string;
  fileUrl?: string;
  fileSize?: number;
  mimeType: string;
  generatedAt: Date;
}

export interface Jurisdiction {
  code: JurisdictionCode;
  name: string;
  supported: boolean;
  currency: string;
  reportFormats: string[];
}
