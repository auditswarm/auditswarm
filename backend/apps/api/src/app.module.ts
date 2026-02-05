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
import { DatabaseModule } from '@auditswarm/database';
import { QueueModule } from '@auditswarm/queue';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
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
  ],
})
export class AppModule {}
