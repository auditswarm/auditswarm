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
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { WalletsService } from './wallets.service';
import { CreateWalletDto, UpdateWalletDto } from './dto';

@ApiTags('wallets')
@Controller('wallets')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class WalletsController {
  constructor(private walletsService: WalletsService) {}

  @Get()
  @ApiOperation({ summary: 'List all wallets for current user' })
  async findAll(@Request() req: { user: { id: string } }) {
    return this.walletsService.findByUserId(req.user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Connect a new wallet' })
  async create(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateWalletDto,
  ) {
    return this.walletsService.create(req.user.id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get wallet details' })
  async findOne(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.walletsService.findById(id, req.user.id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update wallet' })
  async update(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Body() dto: UpdateWalletDto,
  ) {
    return this.walletsService.update(id, req.user.id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Disconnect wallet' })
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
  async getTransactions(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
    @Query('take') take?: number,
    @Query('skip') skip?: number,
  ) {
    return this.walletsService.getTransactions(id, req.user.id, {
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }
}
