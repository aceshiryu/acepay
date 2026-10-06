jest.mock('../../database/entities', () => ({ App: class App {} }));

import { MarketplaceConfigCheck } from './marketplace-config-check';

function build(env: Record<string, string | undefined>, apps: Array<{ name: string }> | Error) {
  const config = { get: (k: string) => env[k] };
  const repo = { find: jest.fn(async () => { if (apps instanceof Error) throw apps; return apps; }) };
  return new MarketplaceConfigCheck(config as never, repo as never);
}

describe('MarketplaceConfigCheck', () => {
  it('is quiet when the platform account is set', async () => {
    expect(await build({ XENDIT_PLATFORM_ACCOUNT_ID: '69a27e4e24dfbfbc12345678' }, [{ name: 'BooklyPH' }]).check()).toBeNull();
  });

  it('is quiet when no app takes marketplace payments', async () => {
    expect(await build({}, []).check()).toBeNull();
  });

  it('names the apps whose payments would fail', async () => {
    const problem = await build({}, [{ name: 'BooklyPH' }]).check();
    expect(problem).toMatch(/XENDIT_PLATFORM_ACCOUNT_ID is not set/);
    expect(problem).toMatch(/BooklyPH/);
  });

  it('never blocks boot when the database is not reachable', async () => {
    expect(await build({}, new Error('ECONNREFUSED')).check()).toBeNull();
  });
});
