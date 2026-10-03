jest.mock('@sentry/node', () => ({
  init: jest.fn(),
  withScope: jest.fn((cb: (s: unknown) => void) => cb({ setTag: jest.fn() })),
  captureException: jest.fn(),
}));

import * as Sentry from '@sentry/node';
import { captureException, initSentry, isSentryEnabled } from './sentry';

describe('sentry observability', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is a no-op when SENTRY_DSN is unset', () => {
    expect(initSentry({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isSentryEnabled()).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initializes when a DSN is provided', () => {
    expect(initSentry({ SENTRY_DSN: 'https://x@o1.ingest.sentry.io/1', NODE_ENV: 'production' } as NodeJS.ProcessEnv))
      .toBe(true);
    expect(isSentryEnabled()).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: expect.stringContaining('sentry.io'), sendDefaultPii: false }),
    );
  });

  it('captureException tags context when enabled', () => {
    initSentry({ SENTRY_DSN: 'https://x@o1.ingest.sentry.io/1' } as NodeJS.ProcessEnv);
    captureException(new Error('boom'), { requestId: 'req-1', appId: 'app-1', provider: 'xendit' });
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it('captureException is a no-op (no throw) when disabled', () => {
    initSentry({} as NodeJS.ProcessEnv);
    expect(() => captureException(new Error('x'))).not.toThrow();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
