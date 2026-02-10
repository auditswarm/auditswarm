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
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
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
  @ApiCreatedResponse({
    description: 'Report generation job dispatched',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        auditId: { type: 'string', format: 'uuid' },
        format: { type: 'string', enum: ['PDF', 'CSV', 'JSON'] },
        status: { type: 'string', example: 'PENDING' },
        jobId: {
          type: 'string',
          description: 'BullMQ job ID for polling status',
        },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async generate(
    @Request() req: { user: { id: string } },
    @Body() dto: GenerateReportDto,
  ) {
    return this.reportsService.generate(req.user.id, dto);
  }

  @Get('audit/:auditId')
  @ApiOperation({ summary: 'Get reports for an audit' })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiOkResponse({
    description: 'List of reports generated for the given audit',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          auditId: { type: 'string', format: 'uuid' },
          format: { type: 'string', enum: ['PDF', 'CSV', 'JSON'] },
          status: {
            type: 'string',
            enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
          },
          fileUrl: { type: 'string', nullable: true },
          fileSizeBytes: { type: 'integer', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  async findByAudit(
    @Request() req: { user: { id: string } },
    @Param('auditId') auditId: string,
    @Query('take') take?: number,
    @Query('skip') skip?: number,
  ) {
    return this.reportsService.findByAuditId(auditId, req.user.id, {
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  @Get('status/:jobId')
  @ApiOperation({ summary: 'Get report generation status' })
  @ApiOkResponse({
    description: 'Current report generation job status',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        status: {
          type: 'string',
          enum: ['waiting', 'active', 'completed', 'failed', 'delayed'],
        },
        progress: { type: 'number', minimum: 0, maximum: 100 },
        result: {
          type: 'object',
          nullable: true,
          properties: {
            reportId: { type: 'string', format: 'uuid' },
            fileUrl: { type: 'string' },
          },
        },
        failedReason: { type: 'string', nullable: true },
      },
    },
  })
  async getStatus(@Param('jobId') jobId: string) {
    return this.reportsService.getJobStatus(jobId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get report details' })
  @ApiOkResponse({
    description: 'Report details',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        auditId: { type: 'string', format: 'uuid' },
        format: { type: 'string', enum: ['PDF', 'CSV', 'JSON'] },
        status: {
          type: 'string',
          enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
        },
        fileUrl: { type: 'string', nullable: true },
        fileSizeBytes: { type: 'integer', nullable: true },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async findOne(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.reportsService.findById(id, req.user.id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Get report download URL' })
  @ApiOkResponse({
    description: 'Presigned download URL for the report file',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Presigned download URL' },
        expiresAt: { type: 'string', format: 'date-time' },
        format: { type: 'string', enum: ['PDF', 'CSV', 'JSON'] },
        fileSizeBytes: { type: 'integer' },
      },
    },
  })
  async download(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.reportsService.download(id, req.user.id);
  }
}
