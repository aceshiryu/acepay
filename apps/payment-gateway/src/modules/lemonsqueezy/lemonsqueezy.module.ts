import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { LemonsqueezyAdminController } from './lemonsqueezy-admin.controller';

@Module({
  imports: [AuthModule, PaymentProvidersModule],
  controllers: [LemonsqueezyAdminController],
})
export class LemonsqueezyModule {}
