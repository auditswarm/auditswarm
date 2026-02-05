import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Attestation, Prisma } from '@prisma/client';

@Injectable()
export class AttestationRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.AttestationCreateInput): Promise<Attestation> {
    return this.prisma.attestation.create({ data });
  }

  async findById(id: string): Promise<Attestation | null> {
    return this.prisma.attestation.findUnique({ where: { id } });
  }

  async findByOnChainAccount(account: string): Promise<Attestation | null> {
    return this.prisma.attestation.findUnique({ where: { onChainAccount: account } });
  }

  async findByWalletId(walletId: string): Promise<Attestation[]> {
    return this.prisma.attestation.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByWalletAddress(address: string): Promise<Attestation[]> {
    return this.prisma.attestation.findMany({
      where: {
        wallet: { address },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByAuditId(auditId: string): Promise<Attestation[]> {
    return this.prisma.attestation.findMany({
      where: { auditId },
    });
  }

  async findActive(walletId: string, jurisdiction: string): Promise<Attestation | null> {
    return this.prisma.attestation.findFirst({
      where: {
        walletId,
        jurisdiction,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      orderBy: { issuedAt: 'desc' },
    });
  }

  async findActiveByAddress(address: string, jurisdiction: string): Promise<Attestation | null> {
    return this.prisma.attestation.findFirst({
      where: {
        wallet: { address },
        jurisdiction,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      orderBy: { issuedAt: 'desc' },
    });
  }

  async update(id: string, data: Prisma.AttestationUpdateInput): Promise<Attestation> {
    return this.prisma.attestation.update({ where: { id }, data });
  }

  async setOnChainData(
    id: string,
    onChain: { account: string; signature: string; slot: bigint; blockTime: bigint },
  ): Promise<Attestation> {
    return this.prisma.attestation.update({
      where: { id },
      data: {
        onChainAccount: onChain.account,
        onChainSignature: onChain.signature,
        onChainSlot: onChain.slot,
        onChainBlockTime: onChain.blockTime,
        status: 'ACTIVE',
        issuedAt: new Date(),
      },
    });
  }

  async revoke(id: string, reason: string): Promise<Attestation> {
    return this.prisma.attestation.update({
      where: { id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokeReason: reason,
      },
    });
  }

  async expireOld(): Promise<{ count: number }> {
    return this.prisma.attestation.updateMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });
  }

  async countActive(walletId?: string): Promise<number> {
    return this.prisma.attestation.count({
      where: {
        walletId,
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
      },
    });
  }
}
