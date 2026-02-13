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
import { AttestationsService, CreateAttestationDto } from './attestations.service';
import { X402Guard, PaymentRequired } from '@auditswarm/x402';

@ApiTags('attestations')
@Controller('attestations')
export class AttestationsController {
  constructor(private attestationsService: AttestationsService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'), X402Guard)
  @ApiBearerAuth()
  @PaymentRequired({
    resource: 'attestation',
    amount: '0.25',
    description: 'On-chain attestation creation',
  })
  @ApiOperation({ summary: 'Create an on-chain attestation' })
  @ApiCreatedResponse({
    description: 'Attestation created and submitted to Solana (covers all audit wallets)',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        auditId: { type: 'string', format: 'uuid' },
        walletId: { type: 'string', format: 'uuid', description: 'Primary wallet ID' },
        jurisdiction: { type: 'string', example: 'US' },
        taxYear: { type: 'integer', example: 2025 },
        type: {
          type: 'string',
          enum: ['TAX_COMPLIANCE', 'AUDIT_COMPLETE', 'REPORTING_COMPLETE', 'QUARTERLY_REVIEW', 'ANNUAL_REVIEW'],
        },
        status: {
          type: 'string',
          enum: ['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED'],
        },
        onChainSignature: {
          type: 'string',
          nullable: true,
          description: 'Solana transaction signature',
        },
        onChainAccount: {
          type: 'string',
          nullable: true,
          description: 'On-chain PDA address',
        },
        hash: { type: 'string', description: 'SHA-256 hash of attested data' },
        createdAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async create(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateAttestationDto,
  ) {
    return this.attestationsService.create(req.user.id, dto);
  }

  @Get('wallet/:walletId')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get attestations for a wallet' })
  @ApiOkResponse({
    description: 'List of attestations for the wallet',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          walletAddress: { type: 'string' },
          jurisdiction: { type: 'string' },
          taxYear: { type: 'integer' },
          attestationType: {
            type: 'string',
            enum: ['TAX_COMPLIANCE', 'AUDIT_COMPLETE', 'INCOME_VERIFIED'],
          },
          status: {
            type: 'string',
            enum: ['PENDING', 'CONFIRMED', 'FAILED', 'REVOKED'],
          },
          transactionSignature: { type: 'string', nullable: true },
          pdaAddress: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  async findByWallet(
    @Request() req: { user: { id: string } },
    @Param('walletId') walletId: string,
  ) {
    return this.attestationsService.findByWalletId(walletId, req.user.id);
  }

  @Get('verify')
  @ApiOperation({ summary: 'Verify an attestation (public)' })
  @ApiQuery({ name: 'address', required: true, type: String })
  @ApiQuery({ name: 'jurisdiction', required: true, type: String })
  @ApiOkResponse({
    description: 'Attestation verification result',
    schema: {
      type: 'object',
      properties: {
        isValid: { type: 'boolean' },
        attestation: {
          type: 'object',
          nullable: true,
          properties: {
            jurisdiction: { type: 'string' },
            taxYear: { type: 'integer' },
            attestationType: { type: 'string' },
            status: { type: 'string' },
            pdaAddress: { type: 'string' },
            dataHash: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        onChainData: {
          type: 'object',
          nullable: true,
          description: 'Data read directly from Solana PDA',
          properties: {
            complianceStatus: { type: 'string' },
            dataHash: { type: 'string' },
            authority: { type: 'string' },
          },
        },
      },
    },
  })
  async verify(
    @Query('address') address: string,
    @Query('jurisdiction') jurisdiction: string,
  ) {
    return this.attestationsService.verify(address, jurisdiction);
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get attestation details' })
  @ApiOkResponse({
    description: 'Attestation details',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        auditId: { type: 'string', format: 'uuid' },
        walletAddress: { type: 'string' },
        jurisdiction: { type: 'string' },
        taxYear: { type: 'integer' },
        attestationType: {
          type: 'string',
          enum: ['TAX_COMPLIANCE', 'AUDIT_COMPLETE', 'INCOME_VERIFIED'],
        },
        status: {
          type: 'string',
          enum: ['PENDING', 'CONFIRMED', 'FAILED', 'REVOKED'],
        },
        transactionSignature: { type: 'string', nullable: true },
        pdaAddress: { type: 'string', nullable: true },
        dataHash: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async findOne(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.attestationsService.findById(id, req.user.id);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke an attestation' })
  @ApiOkResponse({
    description: 'Attestation revoked',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        status: { type: 'string', example: 'REVOKED' },
        revokedAt: { type: 'string', format: 'date-time' },
        reason: { type: 'string' },
        revocationSignature: {
          type: 'string',
          nullable: true,
          description: 'Solana tx signature for revocation',
        },
      },
    },
  })
  async revoke(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    return this.attestationsService.revoke(id, req.user.id, reason);
  }
}
