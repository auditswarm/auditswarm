import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ComplianceService, QuickCheckDto } from './compliance.service';
import { X402Guard, PaymentRequired } from '@auditswarm/x402';
import { JurisdictionCode } from '@auditswarm/common';

@ApiTags('compliance')
@Controller('compliance')
export class ComplianceController {
  constructor(private complianceService: ComplianceService) {}

  @Post('check')
  @UseGuards(X402Guard)
  @PaymentRequired({
    resource: 'compliance',
    amount: '0.05',
    description: 'Quick compliance check',
  })
  @ApiOperation({ summary: 'Quick compliance check for a wallet' })
  async quickCheck(@Body() dto: QuickCheckDto) {
    return this.complianceService.quickCheck(dto);
  }

  @Get('jurisdictions')
  @ApiOperation({ summary: 'List supported jurisdictions' })
  async getJurisdictions() {
    return this.complianceService.getJurisdictions();
  }

  @Get('jurisdictions/:code')
  @ApiOperation({ summary: 'Get jurisdiction requirements' })
  async getRequirements(@Param('code') code: JurisdictionCode) {
    return this.complianceService.getRequirements(code);
  }
}
