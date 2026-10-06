import { isURL, registerDecorator, ValidationOptions } from 'class-validator';

/**
 * http(s) URL for outbound webhook delivery.
 *
 * Outside production, hosts without a TLD (`localhost`, `my-mac`) are allowed
 * so a local app can receive webhooks during development
 * (e.g. `http://localhost:4100/webhooks/acepay`). In production a real domain
 * is required — a live gateway POSTing to its own localhost is never intended.
 * Read at validation time so tests can flip NODE_ENV.
 */
export function isWebhookUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return isURL(value, {
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: process.env.NODE_ENV === 'production',
  });
}

export function IsWebhookUrl(opts?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isWebhookUrl',
      target: target.constructor,
      propertyName: propertyName as string,
      options: {
        message: process.env.NODE_ENV === 'production'
          ? 'webhookUrl must be an http(s) URL with a real domain'
          : 'webhookUrl must be an http(s) URL (localhost is allowed outside production)',
        ...opts,
      },
      validator: { validate: isWebhookUrl },
    });
  };
}
