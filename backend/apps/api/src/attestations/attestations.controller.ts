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
  async revoke(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body('reason') reason: string,
  ) {
    return this.attestationsService.revoke(id, req.user.id, reason);
  }
}
