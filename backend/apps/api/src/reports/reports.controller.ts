import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ReportsService, GenerateReportDto } from './reports.service';
import { X402Guard, PaymentRequired } from '@auditswarm/x402';

@ApiTags('reports')
@Controller('reports')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ReportsController {
  constructor(private reportsService: ReportsService) {}

  @Post()
  @UseGuards(X402Guard)
  @PaymentRequired({
    resource: 'report',
    amount: '0.02',
    description: 'Report generation',
  })
  @ApiOperation({ summary: 'Generate a report' })
  async generate(
    @Request() req: { user: { id: string } },
    @Body() dto: GenerateReportDto,
  ) {
    return this.reportsService.generate(req.user.id, dto);
  }

  @Get('audit/:auditId')
  @ApiOperation({ summary: 'Get reports for an audit' })
  async findByAudit(
    @Request() req: { user: { id: string } },
    @Param('auditId') auditId: string,
  ) {
    return this.reportsService.findByAuditId(auditId, req.user.id);
  }

  @Get('status/:jobId')
  @ApiOperation({ summary: 'Get report generation status' })
  async getStatus(@Param('jobId') jobId: string) {
    return this.reportsService.getJobStatus(jobId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get report details' })
  async findOne(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.reportsService.findById(id, req.user.id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Get report download URL' })
  async download(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.reportsService.download(id, req.user.id);
  }
}
