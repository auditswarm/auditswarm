import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES, ReportJobData } from '@auditswarm/queue';
import { AuditRepository, ReportRepository } from '@auditswarm/database';
import { getBee } from '../bees';
import type { JurisdictionCode, AuditResult } from '@auditswarm/common';

@Processor(QUEUES.REPORT)
export class ReportProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportProcessor.name);

  constructor(
    private auditRepository: AuditRepository,
    private reportRepository: ReportRepository,
  ) {
    super();
  }

  async process(job: Job<ReportJobData>): Promise<void> {
    const { auditId, resultId, format, type, jurisdiction } = job.data;

    this.logger.log(`Generating ${type} report (${format}) for audit ${auditId}`);

    try {
      // Load the audit result
      const result = await this.auditRepository.findResultById(resultId);
      if (!result) {
        throw new Error(`Audit result ${resultId} not found`);
      }

      let fileBuffer: Buffer;
      let mimeType: string;
      let fileName: string;

      switch (type) {
        case 'JSON':
          fileBuffer = this.generateJSON(result);
          mimeType = 'application/json';
          fileName = `audit-${auditId}-${format}.json`;
          break;
        case 'CSV':
          fileBuffer = this.generateCSV(result, format, jurisdiction);
          mimeType = 'text/csv';
          fileName = `audit-${auditId}-${format}.csv`;
          break;
        case 'PDF':
          fileBuffer = await this.generatePDF(result, format, jurisdiction);
          mimeType = 'application/pdf';
          fileName = `audit-${auditId}-${format}.pdf`;
          break;
        case 'XLSX':
          fileBuffer = await this.generateXLSX(result, format, jurisdiction);
          mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          fileName = `audit-${auditId}-${format}.xlsx`;
          break;
        default:
          throw new Error(`Unsupported report type: ${type}`);
      }

      // Save file as base64 data URL for simplicity (no filesystem needed for demo)
      const base64 = fileBuffer.toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64}`;

      // Create or update report record
      await this.reportRepository.create({
        audit: { connect: { id: auditId } },
        type,
        format,
        fileName,
        fileUrl: dataUrl,
        fileSize: fileBuffer.length,
        mimeType,
        metadata: {
          jurisdiction,
          generatedAt: new Date().toISOString(),
        },
      });

      await job.updateProgress(100);
      this.logger.log(`Report ${fileName} generated (${fileBuffer.length} bytes)`);
    } catch (error) {
      this.logger.error(`Report generation failed for audit ${auditId}: ${error}`);
      throw error;
    }
  }

  private generateJSON(result: any): Buffer {
    const report = {
      auditId: result.auditId,
      generatedAt: new Date().toISOString(),
      summary: {
        totalTransactions: result.totalTransactions,
        totalWallets: result.totalWallets,
        periodStart: result.periodStart,
        periodEnd: result.periodEnd,
        netGainLoss: Number(result.netGainLoss),
        totalIncome: Number(result.totalIncome),
        estimatedTax: Number(result.estimatedTax),
        currency: result.currency,
      },
      capitalGains: result.capitalGains,
      income: result.income,
      holdings: result.holdings,
      issues: result.issues,
      recommendations: result.recommendations,
    };

    return Buffer.from(JSON.stringify(report, null, 2));
  }

  private generateCSV(result: any, format: string, jurisdiction: JurisdictionCode): Buffer {
    const capitalGains = result.capitalGains as any;
    const income = result.income as any;
    const lines: string[] = [];

    if (format === 'Form8949' || format === 'TaxSummary') {
      // Capital gains CSV
      lines.push('Description,Date Acquired,Date Sold,Proceeds,Cost Basis,Gain/Loss,Type');

      if (capitalGains?.transactions) {
        for (const tx of capitalGains.transactions) {
          lines.push([
            tx.asset,
            new Date(tx.dateAcquired).toISOString().split('T')[0],
            new Date(tx.dateSold).toISOString().split('T')[0],
            tx.proceeds?.toFixed(2) ?? '0.00',
            tx.costBasis?.toFixed(2) ?? '0.00',
            tx.gainLoss?.toFixed(2) ?? '0.00',
            tx.type,
          ].join(','));
        }
      }

      lines.push('');
      lines.push('Summary');
      lines.push(`Net Short-Term,${capitalGains?.netShortTerm?.toFixed(2) ?? '0.00'}`);
      lines.push(`Net Long-Term,${capitalGains?.netLongTerm?.toFixed(2) ?? '0.00'}`);
      lines.push(`Total Net,${capitalGains?.totalNet?.toFixed(2) ?? '0.00'}`);
      lines.push(`Total Income,${Number(result.totalIncome)?.toFixed(2) ?? '0.00'}`);
      lines.push(`Estimated Tax,${Number(result.estimatedTax)?.toFixed(2) ?? '0.00'}`);
    } else {
      // Generic CSV with income events
      lines.push('Type,Asset,Amount,Value USD,Date,Transaction');

      if (income?.events) {
        for (const evt of income.events) {
          lines.push([
            evt.type,
            evt.asset,
            evt.amount,
            evt.valueUsd?.toFixed(2) ?? '0.00',
            new Date(evt.date).toISOString().split('T')[0],
            evt.transactionSignature ?? '',
          ].join(','));
        }
      }
    }

    return Buffer.from(lines.join('\n'));
  }

  private async generatePDF(result: any, format: string, jurisdiction: JurisdictionCode): Promise<Buffer> {
    // Use jurisdiction bee to generate text report, then wrap in PDF
    const bee = getBee(jurisdiction);
    const beeResult = this.reconstructBeeResult(result);

    let textContent: Buffer;
    try {
      textContent = await bee.generateReport(beeResult, format);
    } catch {
      // Fallback: generate generic text report
      textContent = this.generateGenericTextReport(result, jurisdiction);
    }

    // Use pdfkit to create a PDF
    const PDFDocument = require('pdfkit');

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: `AuditSwarm Tax Report - ${format}`,
          Author: 'AuditSwarm',
          Subject: `${jurisdiction} Tax Compliance Report`,
        },
      });

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).font('Helvetica-Bold')
        .text('AuditSwarm', { align: 'center' });
      doc.fontSize(14).font('Helvetica')
        .text(`Tax Compliance Report — ${jurisdiction}`, { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#666')
        .text(`Generated: ${new Date().toISOString().split('T')[0]}`, { align: 'center' });
      doc.moveDown();

      // Divider
      doc.strokeColor('#ddd').lineWidth(1)
        .moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown();

      // Summary box
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#000')
        .text('Summary');
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica');

      const currency = result.currency || 'USD';
      const sym = currency === 'BRL' ? 'R$' : currency === 'EUR' ? '€' : '$';

      doc.text(`Transactions: ${result.totalTransactions ?? 0}`);
      doc.text(`Period: ${result.periodStart ? new Date(result.periodStart).toLocaleDateString() : 'N/A'} — ${result.periodEnd ? new Date(result.periodEnd).toLocaleDateString() : 'N/A'}`);
      doc.text(`Net Gain/Loss: ${sym}${Number(result.netGainLoss ?? 0).toFixed(2)}`);
      doc.text(`Total Income: ${sym}${Number(result.totalIncome ?? 0).toFixed(2)}`);
      doc.text(`Estimated Tax: ${sym}${Number(result.estimatedTax ?? 0).toFixed(2)}`);
      doc.moveDown();

      // Report content from the bee
      doc.strokeColor('#ddd').lineWidth(1)
        .moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown();
      doc.fontSize(12).font('Helvetica-Bold').text(`${format} Report`);
      doc.moveDown(0.5);
      doc.fontSize(9).font('Courier');

      const textLines = textContent.toString('utf-8').split('\n');
      for (const line of textLines) {
        if (doc.y > 750) {
          doc.addPage();
        }
        doc.text(line);
      }

      // Issues section
      const issues = result.issues as any[];
      if (issues && issues.length > 0) {
        doc.addPage();
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#000')
          .text('Issues & Recommendations');
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica');

        for (const issue of issues) {
          const color = issue.severity === 'HIGH' ? '#e11d48' :
            issue.severity === 'MEDIUM' ? '#d97706' : '#6b7280';
          doc.fillColor(color).text(`[${issue.severity}] ${issue.description}`);
          if (issue.recommendation) {
            doc.fillColor('#666').text(`  → ${issue.recommendation}`);
          }
          doc.moveDown(0.3);
        }
      }

      // Recommendations
      const recs = result.recommendations as string[];
      if (recs && recs.length > 0) {
        doc.moveDown();
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#000')
          .text('Recommendations');
        doc.moveDown(0.5);
        doc.fontSize(10).font('Helvetica');

        for (const rec of recs) {
          doc.fillColor('#333').text(`• ${rec}`);
        }
      }

      // Footer
      doc.fontSize(8).fillColor('#999')
        .text(
          'Generated by AuditSwarm — AI-powered crypto tax compliance',
          50, 780,
          { align: 'center' },
        );

      doc.end();
    });
  }

  private async generateXLSX(result: any, format: string, jurisdiction: JurisdictionCode): Promise<Buffer> {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AuditSwarm';
    workbook.created = new Date();

    // Summary sheet
    const summary = workbook.addWorksheet('Summary');
    summary.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 25 },
    ];
    summary.addRows([
      { metric: 'Jurisdiction', value: jurisdiction },
      { metric: 'Total Transactions', value: result.totalTransactions ?? 0 },
      { metric: 'Period Start', value: result.periodStart ? new Date(result.periodStart).toLocaleDateString() : 'N/A' },
      { metric: 'Period End', value: result.periodEnd ? new Date(result.periodEnd).toLocaleDateString() : 'N/A' },
      { metric: 'Net Gain/Loss', value: Number(result.netGainLoss ?? 0) },
      { metric: 'Total Income', value: Number(result.totalIncome ?? 0) },
      { metric: 'Estimated Tax', value: Number(result.estimatedTax ?? 0) },
      { metric: 'Currency', value: result.currency || 'USD' },
    ]);

    // Capital Gains sheet
    const capitalGains = result.capitalGains as any;
    if (capitalGains?.transactions?.length > 0) {
      const gainsSheet = workbook.addWorksheet('Capital Gains');
      gainsSheet.columns = [
        { header: 'Asset', key: 'asset', width: 15 },
        { header: 'Date Acquired', key: 'dateAcquired', width: 15 },
        { header: 'Date Sold', key: 'dateSold', width: 15 },
        { header: 'Proceeds', key: 'proceeds', width: 15 },
        { header: 'Cost Basis', key: 'costBasis', width: 15 },
        { header: 'Gain/Loss', key: 'gainLoss', width: 15 },
        { header: 'Type', key: 'type', width: 12 },
      ];
      for (const tx of capitalGains.transactions) {
        gainsSheet.addRow({
          asset: tx.asset,
          dateAcquired: new Date(tx.dateAcquired).toLocaleDateString(),
          dateSold: new Date(tx.dateSold).toLocaleDateString(),
          proceeds: tx.proceeds,
          costBasis: tx.costBasis,
          gainLoss: tx.gainLoss,
          type: tx.type,
        });
      }
    }

    // Income sheet
    const income = result.income as any;
    if (income?.events?.length > 0) {
      const incomeSheet = workbook.addWorksheet('Income');
      incomeSheet.columns = [
        { header: 'Type', key: 'type', width: 15 },
        { header: 'Asset', key: 'asset', width: 15 },
        { header: 'Amount', key: 'amount', width: 18 },
        { header: 'Value USD', key: 'valueUsd', width: 15 },
        { header: 'Date', key: 'date', width: 15 },
      ];
      for (const evt of income.events) {
        incomeSheet.addRow({
          type: evt.type,
          asset: evt.asset,
          amount: evt.amount,
          valueUsd: evt.valueUsd,
          date: new Date(evt.date).toLocaleDateString(),
        });
      }
    }

    // Holdings sheet
    const holdings = result.holdings as any;
    if (holdings?.assets?.length > 0) {
      const holdingsSheet = workbook.addWorksheet('Holdings');
      holdingsSheet.columns = [
        { header: 'Symbol', key: 'symbol', width: 12 },
        { header: 'Balance', key: 'balance', width: 18 },
        { header: 'Cost Basis', key: 'costBasis', width: 15 },
        { header: 'Value USD', key: 'valueUsd', width: 15 },
      ];
      for (const asset of holdings.assets) {
        holdingsSheet.addRow({
          symbol: asset.symbol,
          balance: asset.balance,
          costBasis: asset.costBasis,
          valueUsd: asset.valueUsd,
        });
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private reconstructBeeResult(result: any) {
    return {
      capitalGains: result.capitalGains || {
        shortTermGains: 0, shortTermLosses: 0,
        longTermGains: 0, longTermLosses: 0,
        netShortTerm: 0, netLongTerm: 0, totalNet: 0,
        transactions: [],
      },
      income: result.income || {
        staking: 0, mining: 0, airdrops: 0, rewards: 0, other: 0, total: 0, events: [],
      },
      holdings: result.holdings || { totalValueUsd: 0, assets: [], asOf: new Date() },
      issues: result.issues || [],
      recommendations: result.recommendations || [],
      estimatedTax: Number(result.estimatedTax ?? 0),
    };
  }

  private generateGenericTextReport(result: any, jurisdiction: JurisdictionCode): Buffer {
    const currency = result.currency || 'USD';
    const sym = currency === 'BRL' ? 'R$' : currency === 'EUR' ? '€' : '$';

    const lines = [
      `Tax Compliance Report — ${jurisdiction}`,
      '='.repeat(50),
      '',
      `Total Transactions: ${result.totalTransactions ?? 0}`,
      `Net Gain/Loss: ${sym}${Number(result.netGainLoss ?? 0).toFixed(2)}`,
      `Total Income: ${sym}${Number(result.totalIncome ?? 0).toFixed(2)}`,
      `Estimated Tax: ${sym}${Number(result.estimatedTax ?? 0).toFixed(2)}`,
    ];

    return Buffer.from(lines.join('\n'));
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`Report job ${job.id} started`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Report job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Report job ${job.id} failed: ${error.message}`);
  }
}
