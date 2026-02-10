import { Module } from '@nestjs/common';
import { ExchangeConnectionsController } from './exchange-connections.controller';
import { ExchangeConnectionsService } from './exchange-connections.service';
import { ReconciliationService } from './reconciliation.service';

@Module({
  controllers: [ExchangeConnectionsController],
  providers: [ExchangeConnectionsService, ReconciliationService],
  exports: [ExchangeConnectionsService, ReconciliationService],
})
export class ExchangeConnectionsModule {}
