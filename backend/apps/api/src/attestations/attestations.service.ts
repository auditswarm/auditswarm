import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AttestationRepository, AuditRepository, WalletRepository } from '@auditswarm/database';
import {
  QUEUES,
  JOB_NAMES,
  AttestationJobData,
  RevokeAttestationJobData,
} from '@auditswarm/queue';
import { generateAuditHash, JurisdictionCode } from '@auditswarm/common';
import type { Attestation } from '@prisma/client';

export interface CreateAttestationDto {
  auditId: string;
  type: string;
  expiresInDays?: number;
}

@Injectable()
export class AttestationsService {
  constructor(
    private attestationRepository: AttestationRepository,
    private auditRepository: AuditRepository,
    private walletRepository: WalletRepository,
    @InjectQueue(QUEUES.ATTESTATION) private attestationQueue: Queue,
  ) {}

  async create(userId: string, dto: CreateAttestationDto): Promise<Attestation> {
    // Verify audit ownership and completion
    const audit = await this.auditRepository.findById(dto.auditId);
    if (!audit || audit.userId !== userId) {
      throw new NotFoundException('Audit not found');
    }

    if (audit.status !== 'COMPLETED') {
      throw new BadRequestException('Audit must be completed before creating attestation');
    }

    // Get all wallet addresses from the audit
    const auditWallets = (audit as any).wallets as Array<{ walletId: string; wallet: { id: string; address: string } }>;
    if (!auditWallets || auditWallets.length === 0) {
      throw new BadRequestException('Audit has no associated wallets');
    }

    const walletAddresses = auditWallets.map((aw) => aw.wallet.address);
    const primaryWalletId = auditWallets[0].walletId;

    // Generate hash using all wallet addresses
    const result = await this.auditRepository.findResultById(audit.resultId!);
    const hash = generateAuditHash(
      audit.id,
      walletAddresses.join(','),
      audit.taxYear,
      audit.jurisdiction,
      result ? { netGainLoss: result.netGainLoss, totalIncome: result.totalIncome } : {},
    );

    // Calculate expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (dto.expiresInDays || 365));

    // Create attestation record (linked to primary wallet for DB FK)
    const attestation = await this.attestationRepository.create({
      wallet: { connect: { id: primaryWalletId } },
      audit: { connect: { id: dto.auditId } },
      jurisdiction: audit.jurisdiction,
      type: dto.type,
      taxYear: audit.taxYear,
      status: 'PENDING',
      hash,
      expiresAt,
    });

    // Queue on-chain creation with all wallet addresses
    const jobData: AttestationJobData = {
      attestationId: attestation.id,
      auditId: dto.auditId,
      walletAddresses,
      jurisdiction: audit.jurisdiction as JurisdictionCode,
      type: dto.type,
      taxYear: audit.taxYear,
      hash,
      expiresAt,
    };

    await this.attestationQueue.add(JOB_NAMES.CREATE_ATTESTATION, jobData, {
      jobId: `attestation-${attestation.id}`,
    });

    return attestation;
  }

  async findByWalletId(walletId: string, userId: string): Promise<Attestation[]> {
    const wallet = await this.walletRepository.findById(walletId);
    if (!wallet || wallet.userId !== userId) {
      throw new NotFoundException('Wallet not found');
    }

    return this.attestationRepository.findByWalletId(walletId);
  }

  async findById(id: string, userId: string): Promise<Attestation> {
    const attestation = await this.attestationRepository.findById(id);
    if (!attestation) {
      throw new NotFoundException('Attestation not found');
    }

    const wallet = await this.walletRepository.findById(attestation.walletId);
    if (!wallet || wallet.userId !== userId) {
      throw new NotFoundException('Attestation not found');
    }

    return attestation;
  }

  async verify(address: string, jurisdiction: string): Promise<{
    valid: boolean;
    attestation?: Attestation;
    message: string;
  }> {
    const attestation = await this.attestationRepository.findActiveByAddress(
      address,
      jurisdiction,
    );

    if (!attestation) {
      return {
        valid: false,
        message: 'No active attestation found for this wallet and jurisdiction',
      };
    }

    if (attestation.status !== 'ACTIVE') {
      return {
        valid: false,
        attestation,
        message: `Attestation status is ${attestation.status}`,
      };
    }

    if (attestation.expiresAt && attestation.expiresAt < new Date()) {
      return {
        valid: false,
        attestation,
        message: 'Attestation has expired',
      };
    }

    return {
      valid: true,
      attestation,
      message: 'Attestation is valid',
    };
  }

  async revoke(id: string, userId: string, reason: string): Promise<Attestation> {
    const attestation = await this.findById(id, userId);

    if (attestation.status === 'REVOKED') {
      throw new BadRequestException('Attestation is already revoked');
    }

    const revoked = await this.attestationRepository.revoke(id, reason);

    // Queue on-chain revocation if the attestation was created on-chain
    if (attestation.onChainAccount && attestation.hash) {
      const jobData: RevokeAttestationJobData = {
        attestationId: id,
        hash: attestation.hash,
        reason,
      };

      await this.attestationQueue.add(
        JOB_NAMES.REVOKE_ATTESTATION,
        jobData,
        { jobId: `revoke-${id}` },
      );
    }

    return revoked;
  }
}
