import {
  Controller,
  Get,
  Post,
  Delete,
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
import { AuditsService } from './audits.service';
import { CreateAuditDto } from './dto';
import { X402Guard, PaymentRequired } from '@auditswarm/x402';

@ApiTags('audits')
@Controller('audits')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AuditsController {
  constructor(private auditsService: AuditsService) {}

  @Get()
  @ApiOperation({ summary: 'List all audits for current user' })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  @ApiOkResponse({
    description: 'Paginated list of audits',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' },
          walletId: { type: 'string', format: 'uuid' },
          jurisdiction: { type: 'string', example: 'US' },
          taxYear: { type: 'integer', example: 2025 },
          status: {
            type: 'string',
            enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  async findAll(
    @Request() req: { user: { id: string } },
    @Query('take') take?: number,
    @Query('skip') skip?: number,
    @Query('status') status?: string,
  ) {
    return this.auditsService.findByUserId(req.user.id, {
      take: take != null ? Number(take) : undefined,
      skip: skip != null ? Number(skip) : undefined,
      status,
    });
  }

  @Post()
  // TODO: Re-enable x402 payment before production/commit
  // @UseGuards(X402Guard)
  // @PaymentRequired({
  //   resource: 'audit',
  //   amount: '0.10',
  //   description: 'Tax audit request',
  // })
  @ApiOperation({ summary: 'Request a new audit' })
  @ApiCreatedResponse({
    description: 'Audit created and processing dispatched',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        userId: { type: 'string', format: 'uuid' },
        walletId: { type: 'string', format: 'uuid' },
        jurisdiction: { type: 'string', example: 'US' },
        taxYear: { type: 'integer', example: 2025 },
        status: { type: 'string', example: 'PENDING' },
        suggestions: {
          type: 'array',
          nullable: true,
          description: 'Ghost wallet suggestions if high-interaction counterparties found',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              address: { type: 'string' },
              label: { type: 'string', nullable: true },
              interactionCount: { type: 'integer' },
            },
          },
        },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async create(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateAuditDto,
  ) {
    return this.auditsService.create(req.user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get audit details' })
  @ApiOkResponse({
    description: 'Audit details',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        userId: { type: 'string', format: 'uuid' },
        walletId: { type: 'string', format: 'uuid' },
        jurisdiction: { type: 'string', example: 'US' },
        taxYear: { type: 'integer', example: 2025 },
        status: {
          type: 'string',
          enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
        },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async findOne(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.auditsService.findById(id, req.user.id);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get audit status' })
  @ApiOkResponse({
    description: 'Current audit processing status',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: {
          type: 'string',
          enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
        },
        progress: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          nullable: true,
        },
        errorMessage: { type: 'string', nullable: true },
      },
    },
  })
  async getStatus(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.auditsService.getStatus(id, req.user.id);
  }

  @Get(':id/result')
  @ApiOperation({ summary: 'Get audit result' })
  @ApiOkResponse({
    description: 'Audit result with tax calculations',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        auditId: { type: 'string', format: 'uuid' },
        jurisdiction: { type: 'string' },
        taxYear: { type: 'integer' },
        totalIncome: { type: 'number', description: 'Total income in USD' },
        totalGains: { type: 'number', description: 'Total capital gains in USD' },
        totalLosses: { type: 'number', description: 'Total capital losses in USD' },
        netGainLoss: { type: 'number' },
        taxableEvents: { type: 'integer' },
        summary: { type: 'string', description: 'AI-generated summary' },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              description: { type: 'string' },
              severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
            },
          },
        },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async getResult(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.auditsService.getResult(id, req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a pending audit' })
  @ApiOkResponse({
    description: 'Audit cancelled',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Audit cancelled' },
      },
    },
  })
  async cancel(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.auditsService.cancel(id, req.user.id);
  }
}
