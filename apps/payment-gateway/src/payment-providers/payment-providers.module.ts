import { Module } from '@nestjs/common';
import { LemonsqueezyAdapter } from './lemonsqueezy.adapter';
import { ProviderRegistry } from './provider.registry';
import { XenditAdapter } from './xendit.adapter';
import { XenditPlatformClient } from './xendit-platform.client';

@Module({
  providers: [LemonsqueezyAdapter, XenditAdapter, XenditPlatformClient, ProviderRegistry],
  exports: [LemonsqueezyAdapter, XenditAdapter, XenditPlatformClient, ProviderRegistry],
})
export class PaymentProvidersModule {}
