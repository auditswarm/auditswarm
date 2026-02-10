import { IsString, IsNotEmpty, IsOptional, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetAddressLabelDto {
  @ApiProperty({ description: 'Solana wallet address to label' })
  @IsString()
  @IsNotEmpty()
  @Length(32, 44)
  address: string;

  @ApiProperty({ description: 'Label for the address' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiPropertyOptional({ description: 'Entity type classification' })
  @IsString()
  @IsOptional()
  entityType?: string;

  @ApiPropertyOptional({ description: 'Additional notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}
