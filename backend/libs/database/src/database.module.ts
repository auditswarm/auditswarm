import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  UserRepository,
  WalletRepository,
  TransactionRepository,
  AuditRepository,
  AttestationRepository,
  ReportRepository,
  WalletSyncStateRepository,
  TransactionEnrichmentRepository,
  CounterpartyWalletRepository,
  WalletInteractionRepository,
  TokenMetadataRepository,
  WebhookRegistrationRepository,
  TransactionFlowRepository,
  KnownAddressRepository,
  UserAddressLabelRepository,
  WalletFundingSourceRepository,
  PendingClassificationRepository,
  PortfolioSnapshotRepository,
  ExchangeImportRepository,
  ExchangeConnectionRepository,
  TokenSymbolMappingRepository,
} from './repositories';

const repositories = [
  UserRepository,
  WalletRepository,
  TransactionRepository,
  AuditRepository,
  AttestationRepository,
  ReportRepository,
  WalletSyncStateRepository,
  TransactionEnrichmentRepository,
  CounterpartyWalletRepository,
  WalletInteractionRepository,
  TokenMetadataRepository,
  WebhookRegistrationRepository,
  TransactionFlowRepository,
  KnownAddressRepository,
  UserAddressLabelRepository,
  WalletFundingSourceRepository,
  PendingClassificationRepository,
  PortfolioSnapshotRepository,
  ExchangeImportRepository,
  ExchangeConnectionRepository,
  TokenSymbolMappingRepository,
];

@Global()
@Module({
  providers: [PrismaService, ...repositories],
  exports: [PrismaService, ...repositories],
})
export class DatabaseModule {}
