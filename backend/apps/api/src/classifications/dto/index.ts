import { IsString, IsOptional, IsArray, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResolveClassificationDto {
  @ApiProperty({ description: 'Tax category to assign' })
  @IsString()
  @IsNotEmpty()
  category: string;

  @ApiPropertyOptional({ description: 'Optional notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class BatchResolveDto {
  @ApiProperty({ description: 'Array of classification IDs', type: [String] })
  @IsArray()
  @IsString({ each: true })
  ids: string[];

  @ApiProperty({ description: 'Tax category to assign' })
  @IsString()
  @IsNotEmpty()
  category: string;
}
