import { IsString, IsEmail, IsNotEmpty, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SiwsNonceDto {
  @ApiProperty({
    description: 'Solana wallet address',
    example: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
  })
  @IsString()
  @IsNotEmpty()
  @Length(32, 44)
  walletAddress: string;
}

export class SiwsDto {
  @ApiProperty({
    description: 'Solana wallet address',
    example: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK',
  })
  @IsString()
  @IsNotEmpty()
  @Length(32, 44)
  walletAddress: string;

  @ApiProperty({
    description: 'Base58 encoded signature',
  })
  @IsString()
  @IsNotEmpty()
  signature: string;

  @ApiProperty({
    description: 'The message that was signed',
  })
  @IsString()
  @IsNotEmpty()
  message: string;

  @ApiProperty({
    description: 'The nonce from the challenge',
  })
  @IsString()
  @IsNotEmpty()
  nonce: string;
}

export class MagicLinkDto {
  @ApiProperty({
    description: 'Email address',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
