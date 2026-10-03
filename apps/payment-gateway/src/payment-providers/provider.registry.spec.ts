import { BadRequestException } from '@nestjs/common';
import { Provider } from '../common/enums';
import { LemonsqueezyAdapter } from './lemonsqueezy.adapter';
import { ProviderRegistry } from './provider.registry';
import { XenditAdapter } from './xendit.adapter';

describe('ProviderRegistry', () => {
  const lemonsqueezy = { name: Provider.Lemonsqueezy } as unknown as LemonsqueezyAdapter;
  const xendit = { name: Provider.Xendit } as unknown as XenditAdapter;
  const registry = new ProviderRegistry(lemonsqueezy, xendit);

  it.each([
    [Provider.Lemonsqueezy, lemonsqueezy],
    [Provider.Xendit, xendit],
  ])('resolves %s to its adapter instance', (name, expected) => {
    expect(registry.resolve(name)).toBe(expected);
  });

  it('returns the same singleton on repeated lookups', () => {
    expect(registry.resolve(Provider.Xendit)).toBe(registry.resolve(Provider.Xendit));
  });

  // A transaction row can hold a provider value that no longer has an adapter
  // (e.g. the retired 'paymongo'), so this must be a clean 400, not a crash on
  // an undefined adapter further down the call stack.
  it.each([
    ['a retired provider', 'paymongo'],
    ['an unknown provider', 'stripe'],
    ['an empty string', ''],
    ['undefined', undefined],
    ['null', null],
  ])('rejects %s with a 400', (_label, name) => {
    let thrown: unknown;
    try {
      registry.resolve(name as Provider);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).getResponse()).toEqual({
      error: 'unknown_provider',
      message: `Unknown provider: ${name}`,
    });
  });
});
