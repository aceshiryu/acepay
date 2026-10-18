import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { CommonServicesModule } from '../../common/services/common-services.module';
import { Transaction } from '../../database/entities';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { PaymentsAppController } from './payments-app.controller';
import { PaymentsAppService } from './payments-app.service';
import { OneTimePaymentsService } from './one-time-payments.service';
import { AppStatusService } from '../apps/app-status.service';

@Module({
  imports: [
    AuthModule,
    CommonServicesModule,
    PaymentProvidersModule,
    TypeOrmModule.forFeature([Transaction]),
  ],
  controllers: [PaymentsAppController],
  // AppStatusService is stateless (DataSource + credentials); provided here
  // rather than importing AppsModule, whose imports would make a cycle.
  providers: [PaymentsAppService, OneTimePaymentsService, AppStatusService],
  exports: [PaymentsAppService, OneTimePaymentsService],
})
export class PaymentsAppModule {}
