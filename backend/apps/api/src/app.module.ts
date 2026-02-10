import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { WalletsModule } from './wallets/wallets.module';
import { TransactionsModule } from './transactions/transactions.module';
import { AuditsModule } from './audits/audits.module';
import { ReportsModule } from './reports/reports.module';
import { AttestationsModule } from './attestations/attestations.module';
import { ComplianceModule } from './compliance/compliance.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ClassificationsModule } from './classifications/classifications.module';
import { ExchangeImportsModule } from './exchange-imports/exchange-imports.module';
import { ExchangeConnectionsModule } from './exchange-connections/exchange-connections.module';
import { DatabaseModule } from '@auditswarm/database';
import { QueueModule } from '@auditswarm/queue';
import { AuditProcessor } from '../../workflows/src/processors/audit.processor';
import { ReportProcessor } from '../../workflows/src/processors/report.processor';
import { AttestationProcessor } from '../../workflows/src/processors/attestation.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env.local', '../../.env'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
    DatabaseModule,
    QueueModule,
    AuthModule,
    WalletsModule,
    TransactionsModule,
    AuditsModule,
    ReportsModule,
    AttestationsModule,
    ComplianceModule,
    WebhooksModule,
    ClassificationsModule,
    ExchangeImportsModule,
    ExchangeConnectionsModule,
  ],
  providers: [
    AuditProcessor,
    ReportProcessor,
    AttestationProcessor,
  ],
})
export class AppModule {}
