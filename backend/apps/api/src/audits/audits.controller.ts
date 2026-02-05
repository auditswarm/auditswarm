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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
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
  async findAll(
    @Request() req: { user: { id: string } },
    @Query('take') take?: number,
    @Query('skip') skip?: number,
    @Query('status') status?: string,
  ) {
    return this.auditsService.findByUserId(req.user.id, {
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
      status,
    });
  }

  @Post()
  @UseGuards(X402Guard)
  @PaymentRequired({
    resource: 'audit',
    amount: '0.10',
    description: 'Tax audit request',
  })
  @ApiOperation({ summary: 'Request a new audit' })
  async create(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateAuditDto,
  ) {
    return this.auditsService.create(req.user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get audit details' })
  async findOne(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.auditsService.findById(id, req.user.id);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get audit status' })
  async getStatus(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.auditsService.getStatus(id, req.user.id);
  }

  @Get(':id/result')
  @ApiOperation({ summary: 'Get audit result' })
  async getResult(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.auditsService.getResult(id, req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel a pending audit' })
  async cancel(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.auditsService.cancel(id, req.user.id);
  }
}
