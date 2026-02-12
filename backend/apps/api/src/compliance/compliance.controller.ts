import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { ComplianceService, QuickCheckDto } from './compliance.service';
import { X402Guard, PaymentRequired } from '@auditswarm/x402';
import { JurisdictionCode } from '@auditswarm/common';

@ApiTags('compliance')
@Controller('compliance')
export class ComplianceController {
  constructor(private complianceService: ComplianceService) {}

  @Post('check')
  // TODO: Re-enable x402 payment before production/commit
  // @UseGuards(X402Guard)
  // @PaymentRequired({
  //   resource: 'compliance',
  //   amount: '0.05',
  //   description: 'Quick compliance check',
  // })
  @ApiOperation({ summary: 'Quick compliance check for a wallet' })
  @ApiCreatedResponse({
    description: 'Compliance check result',
    schema: {
      type: 'object',
      properties: {
        walletAddress: { type: 'string' },
        jurisdiction: { type: 'string', example: 'US' },
        isCompliant: { type: 'boolean' },
        riskScore: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Risk score (0 = low risk, 100 = high risk)',
        },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'UNREPORTED_INCOME' },
              severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
              description: { type: 'string' },
              recommendation: { type: 'string' },
            },
          },
        },
        summary: { type: 'string', description: 'AI-generated compliance summary' },
        checkedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async quickCheck(@Body() dto: QuickCheckDto) {
    return this.complianceService.quickCheck(dto);
  }

  @Get('jurisdictions')
  @ApiOperation({ summary: 'List supported jurisdictions' })
  @ApiOkResponse({
    description: 'List of supported jurisdictions with basic info',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'US' },
          name: { type: 'string', example: 'United States' },
          isSupported: { type: 'boolean' },
          taxYearsSupported: {
            type: 'array',
            items: { type: 'integer' },
            example: [2023, 2024, 2025],
          },
        },
      },
    },
  })
  async getJurisdictions() {
    return this.complianceService.getJurisdictions();
  }

  @Get('jurisdictions/:code')
  @ApiOperation({ summary: 'Get jurisdiction requirements' })
  @ApiOkResponse({
    description: 'Detailed tax requirements for the jurisdiction',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', example: 'US' },
        name: { type: 'string', example: 'United States' },
        taxAuthority: { type: 'string', example: 'IRS' },
        capitalGainsTaxRate: {
          type: 'object',
          properties: {
            shortTerm: { type: 'string', example: '10-37%' },
            longTerm: { type: 'string', example: '0-20%' },
          },
        },
        reportingThresholds: {
          type: 'object',
          properties: {
            minimumReportable: { type: 'number' },
            currency: { type: 'string', example: 'USD' },
          },
        },
        requiredForms: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', example: 'Form 8949' },
              description: { type: 'string' },
              deadline: { type: 'string', example: 'April 15' },
            },
          },
        },
        cryptoSpecificRules: {
          type: 'array',
          items: { type: 'string' },
          description: 'Crypto-specific tax rules for this jurisdiction',
        },
      },
    },
  })
  async getRequirements(@Param('code') code: JurisdictionCode) {
    return this.complianceService.getRequirements(code);
  }
}
