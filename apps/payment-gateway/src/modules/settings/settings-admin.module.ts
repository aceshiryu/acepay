import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../../auth/auth.module';
import { WebhookEvent } from '../../database/entities';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SettingsAdminController } from './settings-admin.controller';
import { SettingsAdminService } from './settings-admin.service';

@Module({
  imports: [AuthModule, WebhooksModule, PaymentProvidersModule, TypeOrmModule.forFeature([WebhookEvent])],
  controllers: [SettingsAdminController],
  providers: [SettingsAdminService],
  exports: [SettingsAdminService],
})
export class SettingsAdminModule {}
