import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ReportRepository, AuditRepository } from '@auditswarm/database';
import { QUEUES, JOB_NAMES, ReportJobData } from '@auditswarm/queue';
import { JurisdictionCode } from '@auditswarm/common';
import type { Report } from '@prisma/client';

export interface GenerateReportDto {
  auditId: string;
  type: 'PDF' | 'CSV' | 'XLSX' | 'JSON';
  format: string; // Form8949, ScheduleD, IN1888, etc.
}

@Injectable()
export class ReportsService {
  constructor(
    private reportRepository: ReportRepository,
    private auditRepository: AuditRepository,
    @InjectQueue(QUEUES.REPORT) private reportQueue: Queue,
  ) {}

  async generate(userId: string, dto: GenerateReportDto): Promise<{ jobId: string; message: string }> {
    // Verify audit ownership and completion
    const audit = await this.auditRepository.findById(dto.auditId);
    if (!audit || audit.userId !== userId) {
      throw new NotFoundException('Audit not found');
    }

    if (audit.status !== 'COMPLETED') {
      throw new BadRequestException('Audit must be completed before generating reports');
    }

    if (!audit.resultId) {
      throw new BadRequestException('Audit has no result');
    }

    // Queue report generation
    const jobData: ReportJobData = {
      auditId: dto.auditId,
      resultId: audit.resultId,
      format: dto.format,
      type: dto.type,
      jurisdiction: audit.jurisdiction as JurisdictionCode,
    };

    const jobName = this.getJobName(dto.type);
    const job = await this.reportQueue.add(jobName, jobData, {
      jobId: `report-${dto.auditId}-${dto.type}-${dto.format}`,
    });

    return {
      jobId: job.id!,
      message: `Report generation started. Check status at /reports/status/${job.id}`,
    };
  }

  async findByAuditId(auditId: string, userId: string): Promise<Report[]> {
    // Verify ownership
    const audit = await this.auditRepository.findById(auditId);
    if (!audit || audit.userId !== userId) {
      throw new NotFoundException('Audit not found');
    }

    return this.reportRepository.findByAuditId(auditId);
  }

  async findById(id: string, userId: string): Promise<Report> {
    const report = await this.reportRepository.findById(id);
    if (!report) {
      throw new NotFoundException('Report not found');
    }

    // Verify ownership through audit
    const audit = await this.auditRepository.findById(report.auditId);
    if (!audit || audit.userId !== userId) {
      throw new NotFoundException('Report not found');
    }

    return report;
  }

  async download(id: string, userId: string): Promise<{
    fileName: string;
    mimeType: string;
    url: string;
  }> {
    const report = await this.findById(id, userId);

    if (!report.fileUrl) {
      throw new BadRequestException('Report file not ready');
    }

    return {
      fileName: report.fileName,
      mimeType: report.mimeType,
      url: report.fileUrl,
    };
  }

  async getJobStatus(jobId: string): Promise<{
    status: string;
    progress: number;
    result?: Report;
  }> {
    const job = await this.reportQueue.getJob(jobId);
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    const state = await job.getState();
    const progress = job.progress as number || 0;

    return {
      status: state,
      progress,
      result: state === 'completed' ? job.returnvalue : undefined,
    };
  }

  private getJobName(type: string): string {
    switch (type) {
      case 'PDF':
        return JOB_NAMES.GENERATE_PDF;
      case 'CSV':
        return JOB_NAMES.GENERATE_CSV;
      case 'XLSX':
        return JOB_NAMES.GENERATE_XLSX;
      default:
        return JOB_NAMES.GENERATE_PDF;
    }
  }
}
