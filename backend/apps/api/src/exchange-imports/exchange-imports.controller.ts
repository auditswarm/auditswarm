import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ExchangeImportsService } from './exchange-imports.service';
import { UploadExchangeImportDto } from './dto';

@ApiTags('exchange-imports')
@Controller('exchange-imports')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ExchangeImportsController {
  constructor(private exchangeImportsService: ExchangeImportsService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload exchange CSV file' })
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ description: 'Import created and CSV parsed' })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @Request() req: { user: { id: string } },
    @UploadedFile() file: { buffer: Buffer; originalname: string },
    @Body() dto: UploadExchangeImportDto,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const csvContent = file.buffer.toString('utf-8');
    return this.exchangeImportsService.upload(
      req.user.id,
      dto.exchangeName,
      csvContent,
      dto.fileName ?? file.originalname,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List all exchange imports' })
  @ApiOkResponse({ description: 'List of imports' })
  async findAll(@Request() req: { user: { id: string } }) {
    return this.exchangeImportsService.findByUserId(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get import detail with matched/unmatched records' })
  @ApiOkResponse({ description: 'Import detail' })
  async findOne(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.exchangeImportsService.findById(id, req.user.id);
  }

  @Post(':id/confirm')
  @ApiOperation({ summary: 'Confirm matched records' })
  @ApiOkResponse({
    description: 'Number of confirmed matches',
    schema: {
      type: 'object',
      properties: { confirmed: { type: 'integer' } },
    },
  })
  async confirm(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.exchangeImportsService.confirm(id, req.user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an import and its records' })
  @ApiOkResponse({ description: 'Import deleted' })
  async delete(
    @Request() req: { user: { id: string } },
    @Param('id') id: string,
  ) {
    return this.exchangeImportsService.delete(id, req.user.id);
  }
}
