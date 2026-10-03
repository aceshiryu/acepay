import * as Sentry from '@sentry/node';

let enabled = false;

/**
 * Initialize Sentry error tracking. No-op (and safe) when SENTRY_DSN is unset —
 * so local/dev runs need no Sentry account. Call once at bootstrap, before the
 * Nest app is created. Returns whether Sentry is active.
 */
export function initSentry(env: NodeJS.ProcessEnv = process.env): boolean {
  const dsn = env.SENTRY_DSN;
  if (!dsn) {
    enabled = false;
    return false;
  }
  Sentry.init({
    dsn,
    environment: env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // Never ship request bodies / headers by default — they may carry secrets.
    sendDefaultPii: false,
  });
  enabled = true;
  return true;
}

export function isSentryEnabled(): boolean {
  return enabled;
}

/** Report an exception to Sentry if enabled, tagging it with request context.
 *  Swallows any Sentry-side error so reporting never breaks the request path. */
export function captureException(
  error: unknown,
  context?: { requestId?: string; appId?: string; provider?: string },
): void {
  if (!enabled) return;
  try {
    Sentry.withScope((scope) => {
      if (context?.requestId) scope.setTag('request_id', context.requestId);
      if (context?.appId) scope.setTag('app_id', context.appId);
      if (context?.provider) scope.setTag('provider', context.provider);
      Sentry.captureException(error);
    });
  } catch {
    /* never let error reporting throw */
  }
}
