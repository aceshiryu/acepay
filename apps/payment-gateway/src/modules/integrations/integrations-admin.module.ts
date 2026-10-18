import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProviderCredentialChange } from '../../database/entities';
import { AuthModule } from '../../auth/auth.module';
import { PaymentProvidersModule } from '../../payment-providers/payment-providers.module';
import { SettingsAdminModule } from '../settings/settings-admin.module';
import { IntegrationsAdminController } from './integrations-admin.controller';
import { IntegrationsAdminService } from './integrations-admin.service';

@Module({
  imports: [AuthModule, PaymentProvidersModule, SettingsAdminModule, TypeOrmModule.forFeature([ProviderCredentialChange])],
  controllers: [IntegrationsAdminController],
  providers: [IntegrationsAdminService],
})
export class IntegrationsAdminModule {}
