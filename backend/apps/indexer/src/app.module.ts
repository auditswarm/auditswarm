import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '@auditswarm/database';
import { QueueModule } from '@auditswarm/queue';
import { IndexerModule } from './indexer.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env.local', '../../.env'],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    QueueModule,
    IndexerModule,
  ],
})
export class AppModule {}
