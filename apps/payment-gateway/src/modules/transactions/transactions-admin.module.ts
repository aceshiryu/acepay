import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { CommonServicesModule } from '../../common/services/common-services.module';
import {
  Transaction, TransactionLog, WebhookEvent,
} from '../../database/entities';
import { TransactionsAdminController } from './transactions-admin.controller';
import { TransactionsAdminService } from './transactions-admin.service';

@Module({
  imports: [
    AuthModule,
    CommonServicesModule,
    TypeOrmModule.forFeature([Transaction, TransactionLog, WebhookEvent]),
  ],
  controllers: [TransactionsAdminController],
  providers: [TransactionsAdminService],
  exports: [TransactionsAdminService],
})
export class TransactionsAdminModule {}
