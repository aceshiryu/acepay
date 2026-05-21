import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { App, Plan } from '../../database/entities';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { CustomersAppModule } from '../customers/customers-app.module';
import { SubscriptionsAppModule } from '../subscriptions/subscriptions-app.module';
import { AppsController } from './apps.controller';
import { AppsService } from './apps.service';

@Module({
  imports: [
    AuthModule,
    PaymentProvidersModule,
    CustomersAppModule,
    SubscriptionsAppModule,
    TypeOrmModule.forFeature([App, Plan]),
  ],
  controllers: [AppsController],
  providers: [AppsService],
  exports: [AppsService],
})
export class AppsModule {}
