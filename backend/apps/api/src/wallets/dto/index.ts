import { IsString, IsNotEmpty, IsOptional, IsBoolean, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWalletDto {
  @ApiProperty({
    description: 'Solana wallet address',
    example: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
  })
  @IsString()
  @IsNotEmpty()
  @Length(32, 44)
  address: string;

  @ApiPropertyOptional({
    description: 'Label for the wallet',
    example: 'Trading Wallet',
  })
  @IsString()
  @IsOptional()
  label?: string;

  @ApiPropertyOptional({
    description: 'Network (default: solana)',
    example: 'solana',
  })
  @IsString()
  @IsOptional()
  network?: string;
}

export class UpdateWalletDto {
  @ApiPropertyOptional({
    description: 'Label for the wallet',
    example: 'Main Wallet',
  })
  @IsString()
  @IsOptional()
  label?: string;

  @ApiPropertyOptional({
    description: 'Whether the wallet is active',
    example: true,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
