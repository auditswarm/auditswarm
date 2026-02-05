import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AuditRepository, WalletRepository } from '@auditswarm/database';
import { QUEUES, JOB_NAMES, AuditJobData } from '@auditswarm/queue';
import { isJurisdictionSupported, JurisdictionCode } from '@auditswarm/common';
import type { Audit, AuditResult } from '@prisma/client';

export interface CreateAuditDto {
  walletIds: string[];
  jurisdiction: JurisdictionCode;
  type: string;
  taxYear: number;
  periodStart?: Date;
  periodEnd?: Date;
  options?: {
    costBasisMethod?: string;
    includeStaking?: boolean;
    includeAirdrops?: boolean;
    includeNFTs?: boolean;
    includeDeFi?: boolean;
    includeFees?: boolean;
    currency?: string;
  };
}

@Injectable()
export class AuditsService {
  constructor(
    private auditRepository: AuditRepository,
    private walletRepository: WalletRepository,
    @InjectQueue(QUEUES.AUDIT) private auditQueue: Queue,
  ) {}

  async create(userId: string, dto: CreateAuditDto): Promise<Audit> {
    // Validate jurisdiction
    if (!isJurisdictionSupported(dto.jurisdiction)) {
      throw new BadRequestException(`Jurisdiction ${dto.jurisdiction} is not supported`);
    }

    // Validate wallets belong to user
    for (const walletId of dto.walletIds) {
      const wallet = await this.walletRepository.findById(walletId);
      if (!wallet || wallet.userId !== userId) {
        throw new BadRequestException(`Invalid wallet: ${walletId}`);
      }
    }

    // Set default options
    const options = {
      costBasisMethod: dto.options?.costBasisMethod || 'FIFO',
      includeStaking: dto.options?.includeStaking ?? true,
      includeAirdrops: dto.options?.includeAirdrops ?? true,
      includeNFTs: dto.options?.includeNFTs ?? true,
      includeDeFi: dto.options?.includeDeFi ?? true,
      includeFees: dto.options?.includeFees ?? true,
      currency: dto.options?.currency || 'USD',
    };

    // Create audit record
    const audit = await this.auditRepository.create(
      {
        user: { connect: { id: userId } },
        jurisdiction: dto.jurisdiction,
        type: dto.type,
        taxYear: dto.taxYear,
        periodStart: dto.periodStart,
        periodEnd: dto.periodEnd,
        options,
        status: 'QUEUED',
      },
      dto.walletIds,
    );

    // Queue the audit job
    const jobData: AuditJobData = {
      auditId: audit.id,
      userId,
      walletIds: dto.walletIds,
      jurisdiction: dto.jurisdiction,
      taxYear: dto.taxYear,
      options,
    };

    await this.auditQueue.add(JOB_NAMES.PROCESS_AUDIT, jobData, {
      jobId: `audit-${audit.id}`,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });

    return audit;
  }

  async findByUserId(
    userId: string,
    options?: { take?: number; skip?: number; status?: string },
  ): Promise<Audit[]> {
    return this.auditRepository.findByUserId(userId, options);
  }

  async findById(id: string, userId: string): Promise<Audit> {
    const audit = await this.auditRepository.findById(id);
    if (!audit || audit.userId !== userId) {
      throw new NotFoundException('Audit not found');
    }
    return audit;
  }

  async getResult(id: string, userId: string): Promise<AuditResult> {
    const audit = await this.findById(id, userId);
    if (!audit.resultId) {
      throw new NotFoundException('Audit result not ready');
    }

    const result = await this.auditRepository.findResultById(audit.resultId);
    if (!result) {
      throw new NotFoundException('Audit result not found');
    }

    return result;
  }

  async getStatus(id: string, userId: string): Promise<{
    status: string;
    progress: number;
    message?: string;
  }> {
    const audit = await this.findById(id, userId);
    return {
      status: audit.status,
      progress: audit.progress,
      message: audit.statusMessage ?? undefined,
    };
  }

  async cancel(id: string, userId: string): Promise<Audit> {
    const audit = await this.findById(id, userId);

    if (!['PENDING', 'QUEUED'].includes(audit.status)) {
      throw new BadRequestException('Cannot cancel audit in current status');
    }

    // Remove from queue
    const job = await this.auditQueue.getJob(`audit-${id}`);
    if (job) {
      await job.remove();
    }

    return this.auditRepository.updateStatus(id, 'CANCELLED');
  }
}
