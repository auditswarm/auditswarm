import {
  IsString,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsDateString,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class AuditOptionsDto {
  @ApiPropertyOptional({
    description: 'Cost basis calculation method',
    enum: ['FIFO', 'LIFO', 'HIFO', 'SPECIFIC_ID', 'AVERAGE'],
    default: 'FIFO',
  })
  @IsString()
  @IsOptional()
  @IsEnum(['FIFO', 'LIFO', 'HIFO', 'SPECIFIC_ID', 'AVERAGE'])
  costBasisMethod?: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  includeStaking?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  includeAirdrops?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  includeNFTs?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  includeDeFi?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  includeFees?: boolean;

  @ApiPropertyOptional({ default: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;

  // US-specific
  @ApiPropertyOptional({ description: 'FBAR foreign account check (US)' })
  @IsBoolean()
  @IsOptional()
  includeFBAR?: boolean;

  @ApiPropertyOptional({ description: 'Wash sale detection (US)' })
  @IsBoolean()
  @IsOptional()
  includeWashSale?: boolean;

  // EU-specific
  @ApiPropertyOptional({ description: 'MiCA asset classification (EU)' })
  @IsBoolean()
  @IsOptional()
  includeMiCA?: boolean;

  @ApiPropertyOptional({ description: 'Travel Rule compliance check (EU)' })
  @IsBoolean()
  @IsOptional()
  includeTravelRule?: boolean;

  // BR-specific
  @ApiPropertyOptional({ description: 'R$35,000 exemption analysis (BR)' })
  @IsBoolean()
  @IsOptional()
  includeExemption?: boolean;

  @ApiPropertyOptional({ description: 'Generate IN 1888 report (BR)' })
  @IsBoolean()
  @IsOptional()
  includeIN1888?: boolean;
}

export class CreateAuditDto {
  @ApiProperty({
    description: 'Wallet IDs to include in audit',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty()
  walletIds: string[];

  @ApiProperty({
    description: 'Tax jurisdiction',
    enum: ['US', 'EU', 'BR'],
  })
  @IsString()
  @IsNotEmpty()
  @IsEnum(['US', 'EU', 'BR'])
  jurisdiction: 'US' | 'EU' | 'BR';

  @ApiProperty({
    description: 'Audit type',
    enum: ['FULL_TAX_YEAR', 'QUARTERLY', 'MONTHLY', 'SINGLE_WALLET', 'MULTI_WALLET', 'CUSTOM_PERIOD'],
  })
  @IsString()
  @IsNotEmpty()
  type: string;

  @ApiProperty({
    description: 'Tax year',
    example: 2024,
  })
  @IsNumber()
  @Min(2000)
  @Max(2100)
  taxYear: number;

  @ApiPropertyOptional({
    description: 'Custom period start (for CUSTOM_PERIOD type)',
  })
  @IsDateString()
  @IsOptional()
  periodStart?: Date;

  @ApiPropertyOptional({
    description: 'Custom period end (for CUSTOM_PERIOD type)',
  })
  @IsDateString()
  @IsOptional()
  periodEnd?: Date;

  @ApiPropertyOptional({ type: AuditOptionsDto })
  @ValidateNested()
  @Type(() => AuditOptionsDto)
  @IsOptional()
  options?: AuditOptionsDto;
}
