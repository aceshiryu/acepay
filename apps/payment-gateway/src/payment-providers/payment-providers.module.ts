import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProviderCredential } from '../database/entities/provider-credential.entity';
import { LemonsqueezyAdapter } from './lemonsqueezy.adapter';
import { PaymongoAdapter } from './paymongo.adapter';
import { ProviderCredentialsService } from './provider-credentials.service';
import { ProviderRegistry } from './provider.registry';
import { XenditAdapter } from './xendit.adapter';
import { XenditPlatformClient } from './xendit-platform.client';

const PROVIDERS = [
  ProviderCredentialsService, LemonsqueezyAdapter, XenditAdapter, XenditPlatformClient, PaymongoAdapter, ProviderRegistry,
];

@Module({
  imports: [TypeOrmModule.forFeature([ProviderCredential])],
  providers: PROVIDERS,
  exports: PROVIDERS,
})
export class PaymentProvidersModule {}
