import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Report, Prisma } from '@prisma/client';

@Injectable()
export class ReportRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.ReportCreateInput): Promise<Report> {
    return this.prisma.report.create({ data });
  }

  async findById(id: string): Promise<Report | null> {
    return this.prisma.report.findUnique({ where: { id } });
  }

  async findByAuditId(
    auditId: string,
    options?: { take?: number; skip?: number },
  ): Promise<Report[]> {
    return this.prisma.report.findMany({
      where: { auditId },
      take: Number.isFinite(options?.take) ? options!.take : 50,
      skip: Number.isFinite(options?.skip) ? options!.skip : 0,
      orderBy: { generatedAt: 'desc' },
    });
  }

  async findByAuditIdAndFormat(auditId: string, format: string): Promise<Report | null> {
    return this.prisma.report.findFirst({
      where: { auditId, format },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async findByAuditIdAndType(auditId: string, type: string): Promise<Report | null> {
    return this.prisma.report.findFirst({
      where: { auditId, type },
      orderBy: { generatedAt: 'desc' },
    });
  }

  async update(id: string, data: Prisma.ReportUpdateInput): Promise<Report> {
    return this.prisma.report.update({ where: { id }, data });
  }

  async delete(id: string): Promise<Report> {
    return this.prisma.report.delete({ where: { id } });
  }

  async deleteExpired(): Promise<{ count: number }> {
    return this.prisma.report.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
  }

  async countByAuditId(auditId: string): Promise<number> {
    return this.prisma.report.count({ where: { auditId } });
  }
}
