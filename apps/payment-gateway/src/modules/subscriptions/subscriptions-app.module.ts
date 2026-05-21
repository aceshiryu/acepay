import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { CommonServicesModule } from '../../common/services/common-services.module';
import { Customer, Subscription } from '../../database/entities';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { PlansModule } from '../plans/plans.module';
import { SubscriptionsAppController } from './subscriptions-app.controller';
import { SubscriptionsAppService } from './subscriptions-app.service';

@Module({
  imports: [
    AuthModule,
    PlansModule,
    PaymentProvidersModule,
    CommonServicesModule,
    TypeOrmModule.forFeature([Subscription, Customer]),
  ],
  controllers: [SubscriptionsAppController],
  providers: [SubscriptionsAppService],
  exports: [SubscriptionsAppService],
})
export class SubscriptionsAppModule {}
