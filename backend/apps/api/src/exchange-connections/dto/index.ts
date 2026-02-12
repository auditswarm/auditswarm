import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LinkExchangeDto {
  @ApiProperty({ description: 'Exchange name (e.g. binance, coinbase)' })
  @IsString()
  @IsNotEmpty()
  exchangeName: string;

  @ApiProperty({ description: 'API key from the exchange' })
  @IsString()
  @IsNotEmpty()
  apiKey: string;

  @ApiProperty({ description: 'API secret from the exchange' })
  @IsString()
  @IsNotEmpty()
  apiSecret: string;

  @ApiPropertyOptional({ description: 'Sub-account label (optional)' })
  @IsString()
  @IsOptional()
  subAccountLabel?: string;

  @ApiPropertyOptional({ description: 'API passphrase (required for OKX)' })
  @IsString()
  @IsOptional()
  passphrase?: string;
}

export class SyncExchangeDto {
  @ApiPropertyOptional({ description: 'Full sync (ignore cursor)' })
  @IsOptional()
  fullSync?: boolean;
}
