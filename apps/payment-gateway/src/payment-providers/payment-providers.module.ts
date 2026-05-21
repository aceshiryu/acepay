import { Module } from '@nestjs/common';
import { LemonsqueezyAdapter } from './lemonsqueezy.adapter';
import { ProviderRegistry } from './provider.registry';
import { XenditAdapter } from './xendit.adapter';

@Module({
  providers: [LemonsqueezyAdapter, XenditAdapter, ProviderRegistry],
  exports: [LemonsqueezyAdapter, XenditAdapter, ProviderRegistry],
})
export class PaymentProvidersModule {}
