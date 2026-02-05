import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { X402Service } from './x402.service';
import { X402Guard } from './x402.guard';

@Module({
  imports: [ConfigModule],
  providers: [X402Service, X402Guard],
  exports: [X402Service, X402Guard],
})
export class X402Module {}
