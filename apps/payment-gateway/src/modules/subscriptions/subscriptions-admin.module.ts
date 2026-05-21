import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { Plan, Subscription, Transaction } from '../../database/entities';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { SubscriptionsAdminController } from './subscriptions-admin.controller';
import { SubscriptionsAdminService } from './subscriptions-admin.service';

@Module({
  imports: [
    AuthModule,
    PaymentProvidersModule,
    TypeOrmModule.forFeature([Subscription, Plan, Transaction]),
  ],
  controllers: [SubscriptionsAdminController],
  providers: [SubscriptionsAdminService],
  exports: [SubscriptionsAdminService],
})
export class SubscriptionsAdminModule {}
