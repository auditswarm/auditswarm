import type {
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
  JurisdictionCode,
} from './types';

export class AuditSwarmClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(config: AuditSwarmConfig) {
    this.baseUrl = config.apiUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new AuditSwarmError(
        error.message || `Request failed: ${response.status}`,
        response.status,
        error,
      );
    }

    return response.json();
  }

  // ============================================
  // Wallets
  // ============================================

  async getWallets(): Promise<Wallet[]> {
    return this.request<Wallet[]>('/v1/wallets');
  }

  async getWallet(id: string): Promise<Wallet> {
    return this.request<Wallet>(`/v1/wallets/${id}`);
  }

  async createWallet(data: {
    address: string;
    label?: string;
    network?: string;
  }): Promise<Wallet> {
    return this.request<Wallet>('/v1/wallets', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateWallet(
    id: string,
    data: { label?: string; isActive?: boolean },
  ): Promise<Wallet> {
    return this.request<Wallet>(`/v1/wallets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteWallet(id: string): Promise<void> {
    await this.request(`/v1/wallets/${id}`, { method: 'DELETE' });
  }

  // ============================================
  // Transactions
  // ============================================

  async getTransactions(params?: {
    walletId?: string;
    type?: string;
    startDate?: Date;
    endDate?: Date;
    take?: number;
    skip?: number;
  }): Promise<Transaction[]> {
    const queryParams = new URLSearchParams();
    if (params?.walletId) queryParams.set('walletId', params.walletId);
    if (params?.type) queryParams.set('type', params.type);
    if (params?.startDate) queryParams.set('startDate', params.startDate.toISOString());
    if (params?.endDate) queryParams.set('endDate', params.endDate.toISOString());
    if (params?.take) queryParams.set('take', params.take.toString());
    if (params?.skip) queryParams.set('skip', params.skip.toString());

    return this.request<Transaction[]>(`/v1/transactions?${queryParams}`);
  }

  async getTransaction(id: string): Promise<Transaction> {
    return this.request<Transaction>(`/v1/transactions/${id}`);
  }

  // ============================================
  // Audits
  // ============================================

  async getAudits(params?: {
    status?: string;
    take?: number;
    skip?: number;
  }): Promise<Audit[]> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.set('status', params.status);
    if (params?.take) queryParams.set('take', params.take.toString());
    if (params?.skip) queryParams.set('skip', params.skip.toString());

    return this.request<Audit[]>(`/v1/audits?${queryParams}`);
  }

  async getAudit(id: string): Promise<Audit> {
    return this.request<Audit>(`/v1/audits/${id}`);
  }

  async createAudit(data: AuditRequest): Promise<Audit> {
    return this.request<Audit>('/v1/audits', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getAuditStatus(id: string): Promise<{
    status: string;
    progress: number;
    message?: string;
  }> {
    return this.request(`/v1/audits/${id}/status`);
  }

  async getAuditResult(id: string): Promise<AuditResult> {
    return this.request<AuditResult>(`/v1/audits/${id}/result`);
  }

  async cancelAudit(id: string): Promise<Audit> {
    return this.request<Audit>(`/v1/audits/${id}`, { method: 'DELETE' });
  }

  // ============================================
  // Reports
  // ============================================

  async generateReport(data: {
    auditId: string;
    type: 'PDF' | 'CSV' | 'XLSX' | 'JSON';
    format?: string;
  }): Promise<{ jobId: string; message: string }> {
    return this.request('/v1/reports', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getReportsByAudit(auditId: string): Promise<Report[]> {
    return this.request<Report[]>(`/v1/reports/audit/${auditId}`);
  }

  async getReport(id: string): Promise<Report> {
    return this.request<Report>(`/v1/reports/${id}`);
  }

  async downloadReport(id: string): Promise<{
    fileName: string;
    mimeType: string;
    url: string;
  }> {
    return this.request(`/v1/reports/${id}/download`);
  }

  // ============================================
  // Attestations
  // ============================================

  async createAttestation(data: {
    auditId: string;
    walletId: string;
    type: string;
    expiresInDays?: number;
  }): Promise<Attestation> {
    return this.request<Attestation>('/v1/attestations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getAttestationsByWallet(walletId: string): Promise<Attestation[]> {
    return this.request<Attestation[]>(`/v1/attestations/wallet/${walletId}`);
  }

  async getAttestation(id: string): Promise<Attestation> {
    return this.request<Attestation>(`/v1/attestations/${id}`);
  }

  async verifyAttestation(
    address: string,
    jurisdiction: JurisdictionCode,
  ): Promise<{
    valid: boolean;
    attestation?: Attestation;
    message: string;
  }> {
    return this.request(
      `/v1/attestations/verify?address=${address}&jurisdiction=${jurisdiction}`,
    );
  }

  async revokeAttestation(id: string, reason: string): Promise<Attestation> {
    return this.request<Attestation>(`/v1/attestations/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    });
  }

  // ============================================
  // Compliance
  // ============================================

  async checkCompliance(data: {
    walletAddress: string;
    jurisdiction: JurisdictionCode;
    taxYear?: number;
  }): Promise<ComplianceCheck> {
    return this.request<ComplianceCheck>('/v1/compliance/check', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getJurisdictions(): Promise<Jurisdiction[]> {
    return this.request<Jurisdiction[]>('/v1/compliance/jurisdictions');
  }

  async getJurisdiction(code: JurisdictionCode): Promise<Jurisdiction> {
    return this.request<Jurisdiction>(`/v1/compliance/jurisdictions/${code}`);
  }
}

export class AuditSwarmError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'AuditSwarmError';
  }
}
