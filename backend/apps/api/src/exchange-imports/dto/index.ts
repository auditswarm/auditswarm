import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UploadExchangeImportDto {
  @ApiProperty({ description: 'Exchange name (e.g. Coinbase, Binance)' })
  @IsString()
  @IsNotEmpty()
  exchangeName: string;

  @ApiPropertyOptional({ description: 'Original file name' })
  @IsString()
  @IsOptional()
  fileName?: string;
}
