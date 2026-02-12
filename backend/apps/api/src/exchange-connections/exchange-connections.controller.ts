import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ExchangeConnectionsService } from './exchange-connections.service';
import { LinkExchangeDto, SyncExchangeDto } from './dto';

const SUPPORTED_EXCHANGES = [
  {
    id: 'binance',
    name: 'Binance',
    logo: '/exchanges/binance.svg',
    requiredCredentials: ['apiKey', 'apiSecret'],
    optionalCredentials: ['subAccountLabel'],
    features: ['trades', 'deposits', 'withdrawals', 'fiat', 'convert', 'dust', 'c2c', 'staking', 'earn', 'margin', 'mining', 'loans'],
    docs: 'https://www.binance.com/en/support/faq/how-to-create-api-keys-on-binance-360002502072',
    notes: 'Enable "Read Only" permissions. IP whitelist recommended.',
  },
  {
    id: 'bybit',
    name: 'Bybit',
    logo: '/exchanges/bybit.svg',
    requiredCredentials: ['apiKey', 'apiSecret'],
    optionalCredentials: [],
    features: ['trades', 'deposits', 'withdrawals', 'convert', 'c2c', 'staking', 'earn', 'margin'],
    docs: 'https://www.bybit.com/app/user/api-management',
    notes: 'Enable "Read Only" permissions. IP whitelist recommended. Requires Unified Trading Account.',
  },
  {
    id: 'okx',
    name: 'OKX',
    logo: '/exchanges/okx.svg',
    requiredCredentials: ['apiKey', 'apiSecret', 'passphrase'],
    optionalCredentials: [],
    features: ['trades', 'deposits', 'withdrawals', 'convert', 'staking', 'earn', 'margin'],
    docs: 'https://www.okx.com/account/my-api',
    notes: 'Create API key with "Read Only" permission. Passphrase is set during API key creation.',
  },
];

@ApiTags('exchange-connections')
@Controller('exchange-connections')
export class ExchangeConnectionsController {
  constructor(private service: ExchangeConnectionsService) {}

  @Get('available')
  @ApiOperation({ summary: 'List supported exchanges for integration' })
  @ApiOkResponse({ description: 'List of supported exchanges with setup info' })
  available() {
    return SUPPORTED_EXCHANGES;
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Post()
  @ApiOperation({ summary: 'Link an exchange via API keys' })
  @ApiCreatedResponse({ description: 'Exchange linked and credentials verified' })
  async link(
    @Request() req: { user: { id: string } },
    @Body() dto: LinkExchangeDto,
  ) {
    return this.service.link(
      req.user.id,
      dto.exchangeName,
      dto.apiKey,
      dto.apiSecret,
      dto.subAccountLabel,
      dto.passphrase,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Get()
  @ApiOperation({ summary: 'List linked exchanges' })
  @ApiOkResponse({ description: 'List of exchange connections (no secrets)' })
  async findAll(@Request() req: { user: { id: string } }) {
    return this.service.findByUserId(req.user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Post(':id/test')
  @ApiOperation({ summary: 'Test exchange connection' })
  @ApiOkResponse({ description: 'Connection test result' })
  async test(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.service.testConnection(id, req.user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Post(':id/sync')
  @ApiOperation({ summary: 'Trigger exchange data sync' })
  @ApiOkResponse({ description: 'Sync job queued' })
  async sync(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: SyncExchangeDto,
  ) {
    return this.service.sync(id, req.user.id, dto.fullSync);
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Get(':id/status')
  @ApiOperation({ summary: 'Get connection sync status' })
  @ApiOkResponse({ description: 'Connection status' })
  async getStatus(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.service.getStatus(id, req.user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Delete(':id')
  @ApiOperation({ summary: 'Unlink exchange' })
  @ApiOkResponse({ description: 'Exchange unlinked' })
  async unlink(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.service.unlink(id, req.user.id);
  }
}
