import { Module } from '@nestjs/common';
import { ExchangeImportsController } from './exchange-imports.controller';
import { ExchangeImportsService } from './exchange-imports.service';

@Module({
  controllers: [ExchangeImportsController],
  providers: [ExchangeImportsService],
  exports: [ExchangeImportsService],
})
export class ExchangeImportsModule {}
