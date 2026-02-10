import {
  Controller,
  Get,
  Post,
  Patch,
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
import { WalletsService } from './wallets.service';
import { CreateWalletDto, UpdateWalletDto } from './dto';
import { SetAddressLabelDto } from './dto/set-address-label.dto';

@ApiTags('wallets')
@Controller('wallets')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class WalletsController {
  constructor(private walletsService: WalletsService) {}

  @Get()
  @ApiOperation({ summary: 'List all wallets for current user' })
  @ApiOkResponse({
    description: 'List of user wallets',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' },
          address: { type: 'string', description: 'Solana wallet address' },
          network: {
            type: 'string',
            enum: ['mainnet-beta', 'devnet', 'testnet'],
          },
          label: { type: 'string', nullable: true },
          isActive: { type: 'boolean' },
          firstTransactionAt: {
            type: 'string',
            format: 'date-time',
            nullable: true,
          },
          lastTransactionAt: {
            type: 'string',
            format: 'date-time',
            nullable: true,
          },
          transactionCount: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  async findAll(@Request() req: { user: { id: string } }) {
    return this.walletsService.findByUserId(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Connect a new wallet' })
  @ApiCreatedResponse({
    description: 'Wallet successfully connected and indexing dispatched',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        userId: { type: 'string', format: 'uuid' },
        address: { type: 'string', description: 'Solana wallet address' },
        network: {
          type: 'string',
          enum: ['mainnet-beta', 'devnet', 'testnet'],
        },
        label: { type: 'string', nullable: true },
        isActive: { type: 'boolean' },
        firstTransactionAt: {
          type: 'string',
          format: 'date-time',
          nullable: true,
        },
        lastTransactionAt: {
          type: 'string',
          format: 'date-time',
          nullable: true,
        },
        transactionCount: { type: 'integer' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async create(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateWalletDto,
  ) {
    return this.walletsService.create(req.user.id, dto);
  }

  @Get('suggestions/counterparties')
  @ApiOperation({ summary: 'Get ghost wallet suggestions for counterparties' })
  @ApiQuery({ name: 'minInteractions', required: false, type: Number })
  @ApiOkResponse({
    description:
      'List of suggested counterparty wallets based on interaction frequency',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          address: { type: 'string', description: 'Counterparty wallet address' },
          label: { type: 'string', nullable: true },
          labelSource: {
            type: 'string',
            enum: ['USER', 'ENTITY_MATCH', 'KNOWN_PROGRAM'],
            nullable: true,
          },
          entityType: {
            type: 'string',
            enum: [
              'EXCHANGE',
              'DEX',
              'DEFI_PROTOCOL',
              'NFT_MARKETPLACE',
              'DAO',
              'PROGRAM',
              'PERSONAL',
              'BUSINESS',
              'UNKNOWN',
            ],
            nullable: true,
          },
          isKnownProgram: { type: 'boolean' },
          interactionCount: {
            type: 'integer',
            description: 'Number of transactions with this counterparty',
          },
        },
      },
    },
  })
  async getCounterpartySuggestions(
    @Request() req: { user: { id: string } },
    @Query('minInteractions') minInteractions?: number,
  ) {
    return this.walletsService.getCounterpartySuggestions(
      req.user.id,
      minInteractions != null ? Number(minInteractions) : undefined,
    );
  }

  @Get('discoveries')
  @ApiOperation({ summary: 'Get wallet discovery suggestions for dashboard' })
  @ApiOkResponse({ description: 'Wallet discovery suggestions' })
  async getDiscoveries(@Request() req: { user: { id: string } }) {
    return this.walletsService.getDiscoveries(req.user.id);
  }

  @Post('address-labels')
  @ApiOperation({ summary: 'Set a custom label for an address' })
  @ApiCreatedResponse({ description: 'Address label created/updated' })
  async setAddressLabel(
    @Request() req: { user: { id: string } },
    @Body() dto: SetAddressLabelDto,
  ) {
    return this.walletsService.setAddressLabel(
      req.user.id,
      dto.address,
      dto.label,
      dto.entityType,
      dto.notes,
    );
  }

  @Get('address-labels')
  @ApiOperation({ summary: 'List all address labels for current user' })
  @ApiOkResponse({ description: 'List of address labels' })
  async getAddressLabels(@Request() req: { user: { id: string } }) {
    return this.walletsService.getAddressLabels(req.user.id);
  }

  @Delete('address-labels/:id')
  @ApiOperation({ summary: 'Remove an address label' })
  @ApiOkResponse({ description: 'Label removed' })
  async deleteAddressLabel(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    await this.walletsService.deleteAddressLabel(id, req.user.id);
    return { message: 'Address label removed' };
  }

  @Get(':id/funding-source')
  @ApiOperation({ summary: 'Get who funded this wallet' })
  @ApiOkResponse({ description: 'Funding source details' })
  async getFundingSource(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.walletsService.getFundingSource(id, req.user.id);
  }

  @Post(':id/sync')
  @ApiOperation({ summary: 'Force re-sync wallet transactions from chain' })
  @ApiOkResponse({
    description: 'Sync job dispatched',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'SYNCING' },
        message: { type: 'string', example: 'Sync dispatched for wallet ABC...XYZ' },
      },
    },
  })
  async forceSync(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.walletsService.forceSync(id, req.user.id);
  }

  @Get(':id/sync-status')
  @ApiOperation({ summary: 'Get wallet sync/indexing progress' })
  @ApiOkResponse({
    description: 'Current sync status and progress of wallet indexing',
    schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['IDLE', 'SYNCING', 'COMPLETED', 'FAILED', 'PAUSED'],
        },
        progress: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Sync progress percentage',
        },
        totalTransactionsFound: {
          type: 'integer',
          description: 'Total transactions discovered',
        },
        totalTransactionsIndexed: {
          type: 'integer',
          description: 'Transactions successfully indexed',
        },
        errorMessage: {
          type: 'string',
          nullable: true,
          description: 'Error message if status is FAILED',
        },
      },
      required: [
        'status',
        'progress',
        'totalTransactionsFound',
        'totalTransactionsIndexed',
      ],
    },
  })
  async getSyncStatus(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.walletsService.getSyncStatus(id, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get wallet details' })
  @ApiOkResponse({
    description: 'Wallet details',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        userId: { type: 'string', format: 'uuid' },
        address: { type: 'string', description: 'Solana wallet address' },
        network: {
          type: 'string',
          enum: ['mainnet-beta', 'devnet', 'testnet'],
        },
        label: { type: 'string', nullable: true },
        isActive: { type: 'boolean' },
        firstTransactionAt: {
          type: 'string',
          format: 'date-time',
          nullable: true,
        },
        lastTransactionAt: {
          type: 'string',
          format: 'date-time',
          nullable: true,
        },
        transactionCount: { type: 'integer' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async findOne(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.walletsService.findById(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update wallet' })
  @ApiOkResponse({
    description: 'Updated wallet',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        userId: { type: 'string', format: 'uuid' },
        address: { type: 'string', description: 'Solana wallet address' },
        network: {
          type: 'string',
          enum: ['mainnet-beta', 'devnet', 'testnet'],
        },
        label: { type: 'string', nullable: true },
        isActive: { type: 'boolean' },
        firstTransactionAt: {
          type: 'string',
          format: 'date-time',
          nullable: true,
        },
        lastTransactionAt: {
          type: 'string',
          format: 'date-time',
          nullable: true,
        },
        transactionCount: { type: 'integer' },
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  async update(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: UpdateWalletDto,
  ) {
    return this.walletsService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Disconnect wallet' })
  @ApiOkResponse({
    description: 'Wallet successfully disconnected',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Wallet disconnected' },
      },
    },
  })
  async remove(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    await this.walletsService.remove(id, req.user.id);
    return { message: 'Wallet disconnected' };
  }

  @Get(':id/transactions')
  @ApiOperation({ summary: 'Get wallet transactions' })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiOkResponse({
    description: 'Paginated list of wallet transactions',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          walletId: { type: 'string', format: 'uuid' },
          signature: { type: 'string', description: 'Transaction signature' },
          type: {
            type: 'string',
            enum: [
              'TRANSFER',
              'SWAP',
              'STAKE',
              'UNSTAKE',
              'NFT_MINT',
              'NFT_SALE',
              'PROGRAM_INTERACTION',
              'UNKNOWN',
            ],
          },
          status: { type: 'string', enum: ['SUCCESS', 'FAILED', 'PENDING'] },
          timestamp: { type: 'string', format: 'date-time' },
          slot: { type: 'integer' },
          blockTime: { type: 'integer', nullable: true },
          fee: { type: 'string', description: 'Transaction fee in lamports' },
          feePayer: { type: 'string', description: 'Fee payer address' },
          totalValueUsd: {
            type: 'number',
            nullable: true,
            description: 'Total USD value at transaction time',
          },
          transfers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
                amount: { type: 'string' },
                mint: { type: 'string', nullable: true },
                decimals: { type: 'integer' },
              },
            },
          },
          category: { type: 'string', nullable: true },
          subcategory: { type: 'string', nullable: true },
        },
      },
    },
  })
  async getTransactions(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Query('take') take?: number,
    @Query('skip') skip?: number,
  ) {
    return this.walletsService.getTransactions(id, req.user.id, {
      take: take != null ? Number(take) : undefined,
      skip: skip != null ? Number(skip) : undefined,
    });
  }

  @Post('claim/:counterpartyId')
  @ApiOperation({ summary: 'Claim a ghost wallet as your own' })
  @ApiCreatedResponse({
    description: 'Ghost wallet successfully claimed and converted to user wallet',
    schema: {
      type: 'object',
      properties: {
        counterparty: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            address: { type: 'string' },
            label: { type: 'string', nullable: true },
            entityType: {
              type: 'string',
              enum: [
                'EXCHANGE',
                'DEX',
                'DEFI_PROTOCOL',
                'NFT_MARKETPLACE',
                'DAO',
                'PROGRAM',
                'PERSONAL',
                'BUSINESS',
                'UNKNOWN',
              ],
              nullable: true,
            },
          },
        },
        wallet: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            userId: { type: 'string', format: 'uuid' },
            address: { type: 'string', description: 'Solana wallet address' },
            network: {
              type: 'string',
              enum: ['mainnet-beta', 'devnet', 'testnet'],
            },
            label: { type: 'string', nullable: true },
            isActive: { type: 'boolean' },
            firstTransactionAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
            },
            lastTransactionAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
            },
            transactionCount: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  async claimCounterparty(
    @Request() req: { user: { id: string } },
    @Param('counterpartyId') counterpartyId: string,
  ) {
    return this.walletsService.claimCounterparty(req.user.id, counterpartyId);
  }
}
