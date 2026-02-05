import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  UserRepository,
  WalletRepository,
  TransactionRepository,
  AuditRepository,
  AttestationRepository,
  ReportRepository,
} from './repositories';

@Global()
@Module({
  providers: [
    PrismaService,
    UserRepository,
    WalletRepository,
    TransactionRepository,
    AuditRepository,
    AttestationRepository,
    ReportRepository,
  ],
  exports: [
    PrismaService,
    UserRepository,
    WalletRepository,
    TransactionRepository,
    AuditRepository,
    AttestationRepository,
    ReportRepository,
  ],
})
export class DatabaseModule {}
