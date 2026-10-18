import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from '../../database/entities';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { PaymongoPayController } from './paymongo-pay.controller';
import { PaymongoPayService } from './paymongo-pay.service';

@Module({
  imports: [PaymentProvidersModule, TypeOrmModule.forFeature([Subscription])],
  controllers: [PaymongoPayController],
  providers: [PaymongoPayService],
})
export class PaymongoPayModule {}
