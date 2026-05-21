import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { CommonServicesModule } from '../../common/services/common-services.module';
import { Transaction } from '../../database/entities';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { PaymentsAppController } from './payments-app.controller';
import { PaymentsAppService } from './payments-app.service';

@Module({
  imports: [
    AuthModule,
    CommonServicesModule,
    PaymentProvidersModule,
    TypeOrmModule.forFeature([Transaction]),
  ],
  controllers: [PaymentsAppController],
  providers: [PaymentsAppService],
  exports: [PaymentsAppService],
})
export class PaymentsAppModule {}
