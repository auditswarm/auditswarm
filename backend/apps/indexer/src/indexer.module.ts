import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import heliusConfig from './config/helius.config';
import indexerConfig from './config/indexer.config';
import { HeliusService } from './services/helius.service';
import { ATAResolverService } from './services/ata-resolver.service';
import { TokenMetadataService } from './services/token-metadata.service';
import { TransactionParserService } from './services/transaction-parser.service';
import { PriceService } from './services/price.service';
import { CounterpartyService } from './services/counterparty.service';
import { BackfillService } from './services/backfill.service';
import { WebhookManagerService } from './services/webhook-manager.service';
import { FundingSourceService } from './services/funding-source.service';
import { ClassificationService } from './services/classification.service';
import { TaxLotCalculatorService } from './services/tax-lot-calculator.service';
import { CounterpartyAnalysisService } from './services/counterparty-analysis.service';
import { ReconciliationService } from './services/reconciliation.service';
import { ExchangeSyncService } from './services/exchange-sync.service';
import { ExchangeTransactionMapperService } from './services/exchange-transaction-mapper.service';
import { IndexerProcessor } from './processors/indexer.processor';
import { SyncCheckService } from './services/sync-check.service';

@Module({
  imports: [
    ConfigModule.forFeature(heliusConfig),
    ConfigModule.forFeature(indexerConfig),
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 3,
    }),
  ],
  providers: [
    HeliusService,
    ATAResolverService,
    TokenMetadataService,
    TransactionParserService,
    PriceService,
    CounterpartyService,
    BackfillService,
    WebhookManagerService,
    FundingSourceService,
    ClassificationService,
    TaxLotCalculatorService,
    CounterpartyAnalysisService,
    ReconciliationService,
    ExchangeSyncService,
    ExchangeTransactionMapperService,
    IndexerProcessor,
    SyncCheckService,
  ],
})
export class IndexerModule {}
