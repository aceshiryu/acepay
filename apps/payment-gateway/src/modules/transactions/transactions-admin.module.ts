import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { CommonServicesModule } from '../../common/services/common-services.module';
import {
  App, Transaction, TransactionLog, WebhookEvent,
} from '../../database/entities';
import { PaymentsAppModule } from '../payments/payments-app.module';
import { TransactionsAdminController } from './transactions-admin.controller';
import { TransactionsAdminService } from './transactions-admin.service';

@Module({
  imports: [
    AuthModule,
    CommonServicesModule,
    PaymentsAppModule,
    TypeOrmModule.forFeature([Transaction, TransactionLog, WebhookEvent, App]),
  ],
  controllers: [TransactionsAdminController],
  providers: [TransactionsAdminService],
  exports: [TransactionsAdminService],
})
export class TransactionsAdminModule {}
