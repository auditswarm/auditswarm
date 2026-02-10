import {
  Controller,
  Get,
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
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { TransactionsService, TransactionQueryDto, PortfolioQueryDto } from './transactions.service';

const tokenInfoSchema = {
  type: 'object' as const,
  properties: {
    symbol: { type: 'string' as const, example: 'SOL' },
    name: { type: 'string' as const, example: 'Solana' },
    decimals: { type: 'integer' as const, example: 9 },
    logoUrl: { type: 'string' as const, nullable: true },
  },
};

const transferSchema = {
  type: 'object' as const,
  properties: {
    from: { type: 'string' as const, description: 'Sender address' },
    to: { type: 'string' as const, description: 'Receiver address' },
    direction: { type: 'string' as const, enum: ['IN', 'OUT'] },
    amount: { type: 'number' as const, description: 'Human-readable amount (already divided by decimals)' },
    mint: { type: 'string' as const, description: 'Token mint address' },
    token: tokenInfoSchema,
  },
};

const transactionSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const, format: 'uuid' },
    walletId: { type: 'string' as const, format: 'uuid' },
    signature: { type: 'string' as const, description: 'Transaction signature' },
    type: {
      type: 'string' as const,
      enum: [
        'TRANSFER_IN', 'TRANSFER_OUT', 'INTERNAL_TRANSFER',
        'SWAP', 'STAKE', 'UNSTAKE', 'BURN',
        'LP_DEPOSIT', 'LP_WITHDRAW', 'LOAN_BORROW', 'LOAN_REPAY',
        'PROGRAM_INTERACTION', 'UNKNOWN',
        'EXCHANGE_TRADE', 'EXCHANGE_C2C_TRADE', 'EXCHANGE_DEPOSIT', 'EXCHANGE_WITHDRAWAL',
        'EXCHANGE_FIAT_BUY', 'EXCHANGE_FIAT_SELL', 'EXCHANGE_STAKE', 'EXCHANGE_UNSTAKE',
        'EXCHANGE_INTEREST', 'EXCHANGE_DIVIDEND', 'EXCHANGE_DUST_CONVERT', 'EXCHANGE_CONVERT',
        'MARGIN_BORROW', 'MARGIN_REPAY', 'MARGIN_INTEREST', 'MARGIN_LIQUIDATION',
      ],
    },
    source: { type: 'string' as const, enum: ['ONCHAIN', 'EXCHANGE', 'MANUAL'] },
    exchangeName: { type: 'string' as const, nullable: true },
    externalId: { type: 'string' as const, nullable: true },
    linkedTransactionId: { type: 'string' as const, nullable: true, format: 'uuid' },
    status: { type: 'string' as const, enum: ['CONFIRMED', 'FAILED'] },
    timestamp: { type: 'string' as const, format: 'date-time' },
    slot: { type: 'string' as const },
    blockTime: { type: 'string' as const },
    fee: { type: 'string' as const, description: 'Transaction fee in lamports' },
    feePayer: { type: 'string' as const, description: 'Fee payer address' },
    totalValueUsd: {
      type: 'number' as const,
      nullable: true,
      description: 'Total USD value at transaction time',
    },
    summary: {
      type: 'string' as const,
      description: 'Human-readable summary (e.g. "Swapped 1.5 SOL for 32.1 USDC")',
      example: 'Swapped 1.5 SOL for 32.1 USDC',
    },
    transfers: { type: 'array' as const, items: transferSchema },
    enrichment: {
      type: 'object' as const,
      nullable: true,
      properties: {
        protocolName: { type: 'string' as const, nullable: true, example: 'Jupiter' },
        protocolProgramId: { type: 'string' as const, nullable: true },
        heliusType: { type: 'string' as const, nullable: true },
        heliusSource: { type: 'string' as const, nullable: true },
        swapDetails: { type: 'object' as const, nullable: true },
        stakingDetails: {
          type: 'object' as const,
          nullable: true,
          properties: {
            isLiquid: { type: 'boolean' as const },
            protocol: { type: 'string' as const },
            type: { type: 'string' as const, enum: ['stake', 'unstake'] },
          },
        },
        defiDetails: { type: 'object' as const, nullable: true },
        userLabel: { type: 'string' as const, nullable: true },
        userNotes: { type: 'string' as const, nullable: true },
        aiClassification: { type: 'string' as const, nullable: true },
        aiConfidence: { type: 'number' as const, nullable: true },
        isUnknown: { type: 'boolean' as const },
        isFailed: { type: 'boolean' as const },
      },
    },
    costBasis: {
      type: 'object' as const,
      nullable: true,
      properties: {
        method: { type: 'string' as const },
        costBasisUsd: { type: 'number' as const, nullable: true },
        gainLossUsd: { type: 'number' as const, nullable: true },
        gainLossType: { type: 'string' as const, nullable: true, enum: ['SHORT_TERM', 'LONG_TERM'] },
      },
    },
    category: { type: 'string' as const, nullable: true },
    subcategory: { type: 'string' as const, nullable: true },
    createdAt: { type: 'string' as const, format: 'date-time' },
  },
};

@ApiTags('transactions')
@Controller('transactions')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class TransactionsController {
  constructor(private transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'Query transactions' })
  @ApiQuery({ name: 'walletIds', required: false, type: [String] })
  @ApiQuery({ name: 'type', required: false, type: String })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiQuery({ name: 'minValue', required: false, type: Number, description: 'Minimum USD value filter (default: 0.01 to hide spam/dust)' })
  @ApiQuery({ name: 'maxValue', required: false, type: Number })
  @ApiQuery({ name: 'excludeTypes', required: false, type: String, description: 'Comma-separated transaction types to exclude (e.g. UNKNOWN,PROGRAM_INTERACTION)' })
  @ApiQuery({ name: 'source', required: false, type: String, enum: ['ONCHAIN', 'EXCHANGE', 'ALL'], description: 'Filter by transaction source (default: ALL)' })
  @ApiQuery({ name: 'exchangeConnectionId', required: false, type: String, description: 'Filter by specific exchange connection' })
  @ApiQuery({ name: 'sortBy', required: false, type: String, enum: ['timestamp', 'totalValueUsd', 'type', 'fee', 'createdAt'], description: 'Field to sort by (default: timestamp)' })
  @ApiQuery({ name: 'sortOrder', required: false, type: String, enum: ['asc', 'desc'], description: 'Sort direction (default: desc)' })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiOkResponse({
    description: 'Paginated list of transactions matching the filter',
    schema: {
      type: 'array',
      items: transactionSchema,
    },
  })
  async findAll(
    @Request() req: { user: { id: string } },
    @Query() query: TransactionQueryDto,
    @Query('excludeTypes') excludeTypes?: string,
  ) {
    if (excludeTypes) {
      query.excludeTypes = excludeTypes.split(',');
    }
    return this.transactionsService.findByFilter(req.user.id, query);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get transaction statistics' })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiOkResponse({
    description: 'Aggregated transaction statistics',
    schema: {
      type: 'object',
      properties: {
        totalTransactions: { type: 'integer' },
        totalValueUsd: { type: 'number' },
        byType: {
          type: 'object',
          additionalProperties: { type: 'integer' },
          description: 'Transaction count grouped by type',
        },
        byStatus: {
          type: 'object',
          additionalProperties: { type: 'integer' },
          description: 'Transaction count grouped by status',
        },
        byMonth: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              month: { type: 'string', example: '2025-01' },
              count: { type: 'integer' },
              valueUsd: { type: 'number' },
            },
          },
        },
      },
    },
  })
  async getStats(
    @Request() req: { user: { id: string } },
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.transactionsService.getStats(req.user.id, {
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }

  @Get('portfolio/tax-summary')
  @ApiOperation({ summary: 'Get aggregated tax summary with FIFO/LIFO/WAC' })
  @ApiQuery({ name: 'taxYear', required: false, type: Number })
  @ApiQuery({ name: 'method', required: false, type: String, enum: ['FIFO', 'LIFO', 'WAC'] })
  @ApiOkResponse({
    description: 'Tax summary from portfolio snapshots',
    schema: {
      type: 'object',
      properties: {
        taxYear: { type: 'integer' },
        method: { type: 'string' },
        totalRealizedGainLoss: { type: 'number' },
        shortTermGainLoss: { type: 'number' },
        longTermGainLoss: { type: 'number' },
        totalProceeds: { type: 'number' },
        totalCostBasis: { type: 'number' },
        byToken: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              mint: { type: 'string' },
              realizedGainLoss: { type: 'number' },
              shortTermGainLoss: { type: 'number' },
              longTermGainLoss: { type: 'number' },
              totalProceeds: { type: 'number' },
              totalCostBasis: { type: 'number' },
              remainingAmount: { type: 'number' },
            },
          },
        },
      },
    },
  })
  async getTaxSummary(
    @Request() req: { user: { id: string } },
    @Query('taxYear') taxYear?: number,
    @Query('method') method?: string,
  ) {
    return this.transactionsService.getTaxSummary(req.user.id, {
      taxYear: taxYear != null ? Number(taxYear) : undefined,
      method: method ?? 'FIFO',
    });
  }

  @Get('portfolio')
  @ApiOperation({ summary: 'Get token portfolio with PnL across all wallets' })
  @ApiQuery({ name: 'walletIds', required: false, type: [String], description: 'Filter to specific wallet IDs' })
  @ApiQuery({ name: 'includeExchange', required: false, type: Boolean, description: 'Include exchange connection flows in portfolio (default: true)' })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiQuery({ name: 'sortBy', required: false, type: String, enum: ['volume', 'pnl', 'transactions'], description: 'Sort tokens by (default: volume)' })
  @ApiQuery({ name: 'sortOrder', required: false, type: String, enum: ['asc', 'desc'], description: 'Sort direction (default: desc)' })
  @ApiOkResponse({
    description: 'Aggregated PnL per token, split into wallet (on-chain) and exchange sections',
    schema: {
      type: 'object',
      properties: {
        wallet: {
          type: 'object',
          description: 'On-chain wallet portfolio',
          properties: {
            tokens: { type: 'array', items: { $ref: '#/components/schemas/PortfolioToken' } },
            summary: { $ref: '#/components/schemas/PortfolioSummary' },
          },
        },
        exchange: {
          type: 'object',
          description: 'Exchange portfolio (trades, converts — excludes deposits/withdrawals)',
          properties: {
            tokens: { type: 'array', items: { $ref: '#/components/schemas/PortfolioToken' } },
            summary: { $ref: '#/components/schemas/PortfolioSummary' },
          },
        },
      },
    },
  })
  async getPortfolio(
    @Request() req: { user: { id: string } },
    @Query() query: PortfolioQueryDto,
  ) {
    return this.transactionsService.getPortfolio(req.user.id, query);
  }

  @Get('portfolio/:mint')
  @ApiOperation({ summary: 'Get token detail with PnL breakdown and transactions' })
  @ApiQuery({ name: 'walletIds', required: false, type: [String] })
  @ApiQuery({ name: 'startDate', required: false, type: Date })
  @ApiQuery({ name: 'endDate', required: false, type: Date })
  @ApiOkResponse({
    description: 'Token PnL detail with related transactions',
    schema: {
      type: 'object',
      properties: {
        token: {
          type: 'object',
          properties: {
            mint: { type: 'string' },
            symbol: { type: 'string' },
            name: { type: 'string' },
            logoUrl: { type: 'string', nullable: true },
          },
        },
        summary: {
          type: 'object',
          properties: {
            totalBought: { type: 'number' },
            totalSold: { type: 'number' },
            holdingAmount: { type: 'number' },
            totalBoughtUsd: { type: 'number' },
            totalSoldUsd: { type: 'number' },
            realizedPnl: { type: 'number' },
            avgBuyPrice: { type: 'number' },
            avgSellPrice: { type: 'number' },
          },
        },
        transactions: { type: 'array', items: transactionSchema },
      },
    },
  })
  async getPortfolioToken(
    @Request() req: { user: { id: string } },
    @Param('mint') mint: string,
    @Query() query: PortfolioQueryDto,
  ) {
    return this.transactionsService.getPortfolioToken(req.user.id, mint, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get transaction by ID' })
  @ApiOkResponse({
    description: 'Transaction details',
    schema: transactionSchema,
  })
  async findOne(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.transactionsService.findById(id, req.user.id);
  }

  @Get('signature/:signature')
  @ApiOperation({ summary: 'Get transaction by signature' })
  @ApiOkResponse({
    description: 'Transaction details looked up by on-chain signature',
    schema: transactionSchema,
  })
  async findBySignature(
    @Request() req: { user: { id: string } },
    @Param('signature') signature: string,
  ) {
    return this.transactionsService.findBySignature(signature, req.user.id);
  }
}
