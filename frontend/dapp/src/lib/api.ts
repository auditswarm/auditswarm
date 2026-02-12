const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1';

function getAuthHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `API error: ${res.status}`);
  }

  return res.json();
}

// ─── Auth ────────────────────────────────────────────────────────────

export async function getNonce(walletAddress: string): Promise<{ nonce: string; message: string }> {
  return apiFetch('/auth/siws/nonce', {
    method: 'POST',
    body: JSON.stringify({ walletAddress }),
  });
}

export async function signIn(params: {
  walletAddress: string;
  signature: string;
  message: string;
  nonce: string;
}): Promise<{ accessToken: string; user: { id: string; walletAddress: string } }> {
  return apiFetch('/auth/siws', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

interface ApiUser {
  id: string;
  defaultJurisdiction: string | null;
  wallets: { address: string }[];
}

export async function getMe(): Promise<{
  id: string;
  walletAddress: string;
  defaultJurisdiction: string | null;
}> {
  const data = await apiFetch<ApiUser>('/auth/me');
  return {
    id: data.id,
    walletAddress: data.wallets?.[0]?.address ?? '',
    defaultJurisdiction: data.defaultJurisdiction,
  };
}

export async function updateUserPreferences(params: {
  defaultJurisdiction: string;
}): Promise<void> {
  return apiFetch('/auth/me/preferences', {
    method: 'PATCH',
    body: JSON.stringify(params),
  });
}

// ─── Wallets ─────────────────────────────────────────────────────────

export interface Wallet {
  id: string;
  userId: string;
  address: string;
  network: 'mainnet-beta' | 'devnet' | 'testnet';
  label: string | null;
  isActive: boolean;
  firstTransactionAt: string | null;
  lastTransactionAt: string | null;
  transactionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SyncStatus {
  status: 'IDLE' | 'SYNCING' | 'COMPLETED' | 'FAILED' | 'PAUSED';
  progress: number;
  totalTransactionsFound: number;
  totalTransactionsIndexed: number;
  errorMessage: string | null;
}

export interface Counterparty {
  id: string;
  address: string;
  label: string | null;
  labelSource: 'USER' | 'ENTITY_MATCH' | 'KNOWN_PROGRAM' | null;
  entityType:
    | 'EXCHANGE'
    | 'DEX'
    | 'DEFI_PROTOCOL'
    | 'NFT_MARKETPLACE'
    | 'DAO'
    | 'PROGRAM'
    | 'PERSONAL'
    | 'BUSINESS'
    | 'UNKNOWN'
    | null;
  isKnownProgram: boolean;
  interactionCount: number;
}

export interface TransactionTransfer {
  from: string;
  to: string;
  direction: 'IN' | 'OUT';
  amount: number;
  mint: string;
  token: {
    symbol: string;
    name: string;
    decimals: number;
    logoUrl: string | null;
  };
}

export interface TransactionEnrichment {
  protocolName: string | null;
  protocolProgramId: string | null;
  heliusType: string | null;
  heliusSource: string | null;
  swapDetails: Record<string, unknown> | null;
  stakingDetails: {
    isLiquid: boolean;
    protocol: string;
    type: 'stake' | 'unstake';
  } | null;
  defiDetails: Record<string, unknown> | null;
  userLabel: string | null;
  userNotes: string | null;
  aiClassification: string | null;
  aiConfidence: number | null;
  isUnknown: boolean;
  isFailed: boolean;
}

export interface TransactionCostBasis {
  method: string;
  costBasisUsd: number | null;
  gainLossUsd: number | null;
  gainLossType: 'SHORT_TERM' | 'LONG_TERM' | null;
}

export interface Transaction {
  id: string;
  walletId: string;
  signature: string;
  type:
    | 'TRANSFER_IN'
    | 'TRANSFER_OUT'
    | 'INTERNAL_TRANSFER'
    | 'SWAP'
    | 'STAKE'
    | 'UNSTAKE'
    | 'BURN'
    | 'LP_DEPOSIT'
    | 'LP_WITHDRAW'
    | 'LOAN_BORROW'
    | 'LOAN_REPAY'
    | 'PROGRAM_INTERACTION'
    | 'UNKNOWN';
  status: 'CONFIRMED' | 'FAILED';
  timestamp: string;
  slot: string;
  blockTime: string;
  fee: string;
  feePayer: string;
  totalValueUsd: number | null;
  summary: string;
  transfers: TransactionTransfer[];
  enrichment: TransactionEnrichment | null;
  costBasis: TransactionCostBasis | null;
  category: string | null;
  subcategory: string | null;
  createdAt: string;
}

export async function listWallets(): Promise<Wallet[]> {
  return apiFetch('/wallets');
}

export async function createWallet(params: {
  address: string;
  label?: string;
  network?: string;
}): Promise<Wallet> {
  return apiFetch('/wallets', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function getWallet(id: string): Promise<Wallet> {
  return apiFetch(`/wallets/${id}`);
}

export async function updateWallet(
  id: string,
  params: { label?: string; isActive?: boolean },
): Promise<Wallet> {
  return apiFetch(`/wallets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(params),
  });
}

export async function deleteWallet(id: string): Promise<{ message: string }> {
  return apiFetch(`/wallets/${id}`, {
    method: 'DELETE',
  });
}

export async function getSyncStatus(walletId: string): Promise<SyncStatus> {
  return apiFetch(`/wallets/${walletId}/sync-status`);
}

export async function syncWallet(walletId: string): Promise<void> {
  return apiFetch(`/wallets/${walletId}/sync`, { method: 'POST' });
}

export async function getWalletTransactions(
  walletId: string,
  params?: { take?: number; skip?: number },
): Promise<Transaction[]> {
  const query = new URLSearchParams();
  if (params?.take) query.set('take', String(params.take));
  if (params?.skip) query.set('skip', String(params.skip));
  const qs = query.toString();
  return apiFetch(`/wallets/${walletId}/transactions${qs ? `?${qs}` : ''}`);
}

export async function getCounterpartySuggestions(
  minInteractions?: number,
): Promise<Counterparty[]> {
  const qs = minInteractions ? `?minInteractions=${minInteractions}` : '';
  return apiFetch(`/wallets/suggestions/counterparties${qs}`);
}

export async function claimCounterparty(
  counterpartyId: string,
): Promise<{ counterparty: Counterparty; wallet: Wallet }> {
  return apiFetch(`/wallets/claim/${counterpartyId}`, {
    method: 'POST',
  });
}

// ─── Transactions ────────────────────────────────────────────────────

export interface TransactionQuery {
  skip?: number;
  take?: number;
  startDate?: string;
  endDate?: string;
  type?: string;
  excludeTypes?: string[];
  walletIds?: string[];
  sortBy?: 'timestamp' | 'totalValueUsd' | 'type' | 'fee' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
  minValue?: number;
  maxValue?: number;
}

export async function queryTransactions(params?: TransactionQuery): Promise<Transaction[]> {
  const query = new URLSearchParams();
  if (params?.skip) query.set('skip', String(params.skip));
  if (params?.take) query.set('take', String(params.take));
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  if (params?.type) query.set('type', params.type);
  if (params?.excludeTypes) params.excludeTypes.forEach((t) => query.append('excludeTypes', t));
  if (params?.walletIds) params.walletIds.forEach((id) => query.append('walletIds', id));
  if (params?.sortBy) query.set('sortBy', params.sortBy);
  if (params?.sortOrder) query.set('sortOrder', params.sortOrder);
  if (params?.minValue != null) query.set('minValue', String(params.minValue));
  if (params?.maxValue != null) query.set('maxValue', String(params.maxValue));
  const qs = query.toString();
  return apiFetch(`/transactions${qs ? `?${qs}` : ''}`);
}

export interface TransactionStats {
  totalTransactions: number;
  totalValueUsd: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byMonth: { month: string; count: number; valueUsd: number }[];
}

export async function getTransactionStats(params?: {
  startDate?: string;
  endDate?: string;
}): Promise<TransactionStats> {
  const query = new URLSearchParams();
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  const qs = query.toString();
  return apiFetch(`/transactions/stats${qs ? `?${qs}` : ''}`);
}

// ─── Portfolio ──────────────────────────────────────────────────────

export interface PortfolioToken {
  mint: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  totalBought: number;
  totalSold: number;
  holdingAmount: number;
  totalBoughtUsd: number;
  totalSoldUsd: number;
  realizedPnl: number;
  avgBuyPrice: number;
  avgSellPrice: number;
  totalVolume: number;
  buyCount: number;
  sellCount: number;
  firstTx: string;
  lastTx: string;
}

export interface PortfolioSummary {
  totalTokens: number;
  totalRealizedPnl: number;
  totalVolumeUsd: number;
  totalBoughtUsd: number;
  totalSoldUsd: number;
}

export interface PortfolioSection {
  tokens: PortfolioToken[];
  summary: PortfolioSummary;
}

export interface Portfolio {
  wallet: PortfolioSection;
  exchange: PortfolioSection;
}

export interface PortfolioQuery {
  sortBy?: 'volume' | 'pnl' | 'transactions';
  sortOrder?: 'asc' | 'desc';
  startDate?: string;
  endDate?: string;
  walletIds?: string[];
}

export async function getPortfolio(params?: PortfolioQuery): Promise<Portfolio> {
  const query = new URLSearchParams();
  if (params?.sortBy) query.set('sortBy', params.sortBy);
  if (params?.sortOrder) query.set('sortOrder', params.sortOrder);
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  if (params?.walletIds) params.walletIds.forEach((id) => query.append('walletIds', id));
  const qs = query.toString();
  return apiFetch(`/transactions/portfolio${qs ? `?${qs}` : ''}`);
}

export interface PortfolioTokenDetail {
  token: {
    mint: string;
    symbol: string;
    name: string;
    logoUrl: string | null;
  };
  summary: {
    totalBought: number;
    totalSold: number;
    holdingAmount: number;
    totalBoughtUsd: number;
    totalSoldUsd: number;
    realizedPnl: number;
    avgBuyPrice: number;
    avgSellPrice: number;
  };
  transactions: Transaction[];
}

export async function getPortfolioToken(
  mint: string,
  params?: { startDate?: string; endDate?: string; walletIds?: string[] },
): Promise<PortfolioTokenDetail> {
  const query = new URLSearchParams();
  if (params?.startDate) query.set('startDate', params.startDate);
  if (params?.endDate) query.set('endDate', params.endDate);
  if (params?.walletIds) params.walletIds.forEach((id) => query.append('walletIds', id));
  const qs = query.toString();
  return apiFetch(`/transactions/portfolio/${mint}${qs ? `?${qs}` : ''}`);
}

// ─── Audits ─────────────────────────────────────────────────────────

export type AuditStatus = 'QUEUED' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface Audit {
  id: string;
  userId: string;
  walletId: string;
  jurisdiction: string;
  type: string;
  taxYear: number;
  periodStart?: string;
  periodEnd?: string;
  status: AuditStatus;
  createdAt: string;
  updatedAt: string;
}

export interface AuditStatusResponse {
  id: string;
  status: AuditStatus;
  progress: number | null;
  errorMessage: string | null;
}

export interface CapitalGainTransaction {
  id: string;
  asset: string;
  dateAcquired: string;
  dateSold: string;
  proceeds: number;
  costBasis: number;
  gainLoss: number;
  type: 'SHORT_TERM' | 'LONG_TERM';
  transactionSignature: string;
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

export interface IncomeEvent {
  id: string;
  type: string;
  asset: string;
  amount: number;
  valueUsd: number;
  date: string;
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

export interface HoldingAsset {
  mint: string;
  symbol: string;
  balance: number;
  valueUsd: number;
  costBasis: number;
  unrealizedGainLoss: number;
}

export interface HoldingsReport {
  totalValueUsd: number;
  assets: HoldingAsset[];
  asOf: string;
}

export interface AuditIssue {
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  type: string;
  description: string;
  transaction?: string;
  recommendation?: string;
}

export interface MonthlyBreakdownEntry {
  month: number;
  label: string;
  salesVolume: number;
  capitalGains: number;
  exempt: boolean;
  taxableGains: number;
  threshold: number;
}

export interface MonthlyBreakdown {
  entries: MonthlyBreakdownEntry[];
  currency: string;
  totalExemptGains: number;
  totalTaxableGains: number;
  exemptMonths: number;
  taxableMonths: number;
}

export interface AuditResult {
  id: string;
  auditId: string;
  totalTransactions: number;
  totalWallets: number;
  periodStart: string;
  periodEnd: string;
  netGainLoss: number | string;
  totalIncome: number | string;
  estimatedTax: number | string;
  currency: string;
  capitalGains: CapitalGainsReport;
  income: IncomeReport;
  holdings: HoldingsReport;
  issues: AuditIssue[] | null;
  recommendations: string[] | null;
  metadata: {
    version: string;
    beeVersion: string;
    processedAt: string;
    monthlyBreakdown?: MonthlyBreakdown;
    [key: string]: unknown;
  } | null;
  hash: string | null;
  createdAt: string;
}

export interface CreateAuditDto {
  walletIds: string[];
  jurisdiction: 'US' | 'EU' | 'BR';
  type: 'ANNUAL' | 'FULL_TAX_YEAR' | 'QUARTERLY' | 'SINGLE_WALLET' | 'MULTI_WALLET' | 'CUSTOM_PERIOD';
  taxYear: number;
  periodStart?: string;
  periodEnd?: string;
  options?: {
    costBasisMethod?: 'FIFO' | 'LIFO' | 'HIFO' | 'SPECIFIC_ID' | 'AVERAGE';
    includeStaking?: boolean;
    includeAirdrops?: boolean;
    includeNFTs?: boolean;
    includeDeFi?: boolean;
    includeFees?: boolean;
    currency?: string;
  };
}

export async function listAudits(params?: {
  take?: number;
  skip?: number;
  status?: AuditStatus;
}): Promise<Audit[]> {
  const query = new URLSearchParams();
  if (params?.take) query.set('take', String(params.take));
  if (params?.skip) query.set('skip', String(params.skip));
  if (params?.status) query.set('status', params.status);
  const qs = query.toString();
  return apiFetch(`/audits${qs ? `?${qs}` : ''}`);
}

export async function createAudit(dto: CreateAuditDto): Promise<Audit> {
  return apiFetch('/audits', { method: 'POST', body: JSON.stringify(dto) });
}

export async function getAudit(id: string): Promise<Audit> {
  return apiFetch(`/audits/${id}`);
}

export async function getAuditStatus(id: string): Promise<AuditStatusResponse> {
  return apiFetch(`/audits/${id}/status`);
}

export async function getAuditResult(id: string): Promise<AuditResult> {
  return apiFetch(`/audits/${id}/result`);
}

export async function cancelAudit(id: string): Promise<{ message: string }> {
  return apiFetch(`/audits/${id}`, { method: 'DELETE' });
}

// ─── Reports ────────────────────────────────────────────────────────

export type ReportStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface Report {
  id: string;
  auditId: string;
  format: string;
  status: ReportStatus;
  fileUrl: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateReportDto {
  auditId: string;
  type: 'PDF' | 'CSV' | 'XLSX' | 'JSON';
  format: string;
}

export interface ReportDownload {
  url: string;
  expiresAt: string;
  format: string;
  fileSizeBytes: number;
}

export interface ReportJobStatus {
  jobId: string;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  progress: number;
  result?: { reportId: string; fileUrl: string };
  failedReason: string | null;
}

export async function createReport(dto: GenerateReportDto): Promise<{ jobId: string; message: string }> {
  return apiFetch('/reports', { method: 'POST', body: JSON.stringify(dto) });
}

export async function getReportsForAudit(
  auditId: string,
  params?: { take?: number; skip?: number },
): Promise<Report[]> {
  const query = new URLSearchParams();
  if (params?.take) query.set('take', String(params.take));
  if (params?.skip) query.set('skip', String(params.skip));
  const qs = query.toString();
  return apiFetch(`/reports/audit/${auditId}${qs ? `?${qs}` : ''}`);
}

export async function getReport(id: string): Promise<Report> {
  return apiFetch(`/reports/${id}`);
}

export async function getReportDownload(id: string): Promise<ReportDownload> {
  return apiFetch(`/reports/${id}/download`);
}

export async function getReportJobStatus(jobId: string): Promise<ReportJobStatus> {
  return apiFetch(`/reports/status/${jobId}`);
}

// ─── Attestations ───────────────────────────────────────────────────

export interface Attestation {
  id: string;
  walletAddress: string;
  jurisdiction: string;
  taxYear: number;
  attestationType: 'TAX_COMPLIANCE' | 'AUDIT_COMPLETE' | 'INCOME_VERIFIED';
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'REVOKED';
  transactionSignature: string | null;
  pdaAddress: string | null;
  createdAt: string;
}

export async function getWalletAttestations(walletId: string): Promise<Attestation[]> {
  return apiFetch(`/attestations/wallet/${walletId}`);
}

// ─── Exchange Connections ───────────────────────────────────────────

export interface AvailableExchange {
  id: string;
  name: string;
  logo: string;
  requiredCredentials: string[];
  optionalCredentials: string[];
  features: string[];
  docs: string;
  notes: string;
}

export interface ExchangeConnection {
  id: string;
  exchangeName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ERROR' | 'REVOKED';
  lastSyncAt: string | null;
  lastError: string | null;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LinkExchangeDto {
  exchangeName: string;
  apiKey: string;
  apiSecret: string;
  subAccountLabel?: string;
  passphrase?: string;
}

export interface ExchangeConnectionResult {
  id: string;
  exchangeName: string;
  status: string;
  permissions: string[];
  accountId?: string;
}

export interface ExchangeSyncStatus {
  status: string;
  connectionId: string;
}

export async function getAvailableExchanges(): Promise<AvailableExchange[]> {
  return apiFetch('/exchange-connections/available');
}

export async function linkExchange(dto: LinkExchangeDto): Promise<ExchangeConnectionResult> {
  return apiFetch('/exchange-connections', { method: 'POST', body: JSON.stringify(dto) });
}

export async function listExchangeConnections(): Promise<ExchangeConnection[]> {
  return apiFetch('/exchange-connections');
}

export async function testExchangeConnection(id: string): Promise<{ valid: boolean; error?: string }> {
  return apiFetch(`/exchange-connections/${id}/test`, { method: 'POST' });
}

export async function syncExchangeConnection(
  id: string,
  params?: { fullSync?: boolean },
): Promise<ExchangeSyncStatus> {
  return apiFetch(`/exchange-connections/${id}/sync`, {
    method: 'POST',
    body: JSON.stringify(params ?? {}),
  });
}

export async function getExchangeSyncStatus(id: string): Promise<ExchangeSyncStatus> {
  return apiFetch(`/exchange-connections/${id}/status`);
}

export async function deleteExchangeConnection(id: string): Promise<{ message: string }> {
  return apiFetch(`/exchange-connections/${id}`, { method: 'DELETE' });
}

// ─── Exchange Imports ───────────────────────────────────────────────

export interface ExchangeImport {
  id: string;
  exchangeName: string;
  importType: 'CSV' | 'API';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  totalRecords: number;
  matchedRecords: number;
  unmatchedRecords: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listExchangeImports(): Promise<ExchangeImport[]> {
  return apiFetch('/exchange-imports');
}

export async function getExchangeImport(id: string): Promise<ExchangeImport> {
  return apiFetch(`/exchange-imports/${id}`);
}

export async function deleteExchangeImport(id: string): Promise<{ message: string }> {
  return apiFetch(`/exchange-imports/${id}`, { method: 'DELETE' });
}

export async function confirmExchangeImport(id: string): Promise<{ count: number }> {
  return apiFetch(`/exchange-imports/${id}/confirm`, { method: 'POST' });
}
