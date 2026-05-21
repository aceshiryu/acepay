import { BadRequestException, Injectable } from '@nestjs/common';
import { Provider } from '../common/enums';
import { LemonsqueezyAdapter } from './lemonsqueezy.adapter';
import { PaymentProvider } from './provider.types';
import { XenditAdapter } from './xendit.adapter';

@Injectable()
export class ProviderRegistry {
  constructor(
    private readonly lemonsqueezy: LemonsqueezyAdapter,
    private readonly xendit: XenditAdapter,
  ) {}

  resolve(name: Provider): PaymentProvider {
    switch (name) {
      case Provider.Lemonsqueezy: return this.lemonsqueezy;
      case Provider.Xendit:       return this.xendit;
      default:
        throw new BadRequestException({
          error: 'unknown_provider', message: `Unknown provider: ${name}`,
        });
    }
  }
}
