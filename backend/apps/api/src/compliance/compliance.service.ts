import { Injectable, NotFoundException } from '@nestjs/common';
import { AttestationRepository, AuditRepository, WalletRepository } from '@auditswarm/database';
import {
  JurisdictionCode,
  QuickComplianceCheckResult,
  ComplianceStatus,
  getJurisdiction,
} from '@auditswarm/common';

export interface QuickCheckDto {
  walletAddress: string;
  jurisdiction: JurisdictionCode;
  taxYear?: number;
}

@Injectable()
export class ComplianceService {
  constructor(
    private attestationRepository: AttestationRepository,
    private auditRepository: AuditRepository,
    private walletRepository: WalletRepository,
  ) {}

  async quickCheck(dto: QuickCheckDto): Promise<QuickComplianceCheckResult> {
    const jurisdiction = getJurisdiction(dto.jurisdiction);
    const taxYear = dto.taxYear ? Number(dto.taxYear) : new Date().getFullYear();

    // Find wallet by address
    const wallet = await this.walletRepository.findByAddress(dto.walletAddress);

    // Check for active attestation
    const attestation = await this.attestationRepository.findActiveByAddress(
      dto.walletAddress,
      dto.jurisdiction,
    );

    // Find latest audit for this wallet
    let lastAuditDate: Date | undefined;
    if (wallet) {
      const audits = await this.auditRepository.findByUserId(wallet.userId, {
        status: 'COMPLETED',
        take: 1,
      });
      if (audits.length > 0) {
        lastAuditDate = audits[0].completedAt ?? undefined;
      }
    }

    // Determine compliance status
    let status: ComplianceStatus;
    let score: number;
    let summary: string;
    const recommendedActions: string[] = [];

    if (attestation && attestation.status === 'ACTIVE') {
      status = 'COMPLIANT';
      score = 100;
      summary = `Wallet has valid ${dto.jurisdiction} tax attestation for ${taxYear}`;
    } else if (lastAuditDate) {
      const daysSinceAudit = Math.floor(
        (Date.now() - lastAuditDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysSinceAudit < 90) {
        status = 'COMPLIANT';
        score = 85;
        summary = `Recent audit completed ${daysSinceAudit} days ago`;
        recommendedActions.push('Create on-chain attestation for permanent proof');
      } else if (daysSinceAudit < 365) {
        status = 'NEEDS_REVIEW';
        score = 60;
        summary = `Last audit was ${daysSinceAudit} days ago, review recommended`;
        recommendedActions.push('Request updated audit for current period');
        recommendedActions.push('Create on-chain attestation');
      } else {
        status = 'NEEDS_REVIEW';
        score = 40;
        summary = 'Audit is over a year old, new audit recommended';
        recommendedActions.push('Request full tax year audit');
      }
    } else if (wallet) {
      status = 'NEEDS_REVIEW';
      score = 30;
      summary = 'Wallet has no audit history';
      recommendedActions.push('Request initial tax audit');
      recommendedActions.push(`Review ${jurisdiction.name} crypto tax requirements`);
    } else {
      status = 'UNKNOWN';
      score = 0;
      summary = 'Wallet not registered in AuditSwarm';
      recommendedActions.push('Connect wallet to AuditSwarm');
      recommendedActions.push('Request initial compliance audit');
    }

    return {
      walletAddress: dto.walletAddress,
      jurisdiction: dto.jurisdiction,
      status,
      score,
      summary,
      hasAttestation: !!attestation,
      attestationExpiry: attestation?.expiresAt ?? undefined,
      lastAuditDate,
      recommendedActions,
    };
  }

  async getJurisdictions() {
    return [
      { code: 'US', name: 'United States', supported: true },
      { code: 'EU', name: 'European Union', supported: true },
      { code: 'BR', name: 'Brazil', supported: true },
      { code: 'UK', name: 'United Kingdom', supported: false },
      { code: 'JP', name: 'Japan', supported: false },
      { code: 'AU', name: 'Australia', supported: false },
    ];
  }

  async getRequirements(jurisdiction: JurisdictionCode) {
    const config = getJurisdiction(jurisdiction);
    if (!config) {
      throw new NotFoundException('Jurisdiction not found');
    }

    return {
      jurisdiction: config.code,
      name: config.name,
      currency: config.currency,
      taxYear: config.taxYear,
      features: config.features,
      reportFormats: config.reportFormats,
    };
  }
}
