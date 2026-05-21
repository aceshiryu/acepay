import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { App, Plan } from '../../database/entities';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { PlansAdminController } from './plans-admin.controller';
import { PlansAppController } from './plans-app.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [
    AuthModule,
    PaymentProvidersModule,
    TypeOrmModule.forFeature([Plan, App]),
  ],
  controllers: [PlansAdminController, PlansAppController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
