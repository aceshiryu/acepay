import { registerDecorator, ValidationOptions } from 'class-validator';

// Standard URL scheme: lowercase letter then alphanum / + . - (RFC 3986).
const SCHEME_RE = /^([a-z][a-z0-9+.\-]*):\/\/.+$/i;

// Schemes that should never be a redirect target — they can execute code or
// read local files in a browser context and are virtually never legitimate
// for a post-checkout redirect.
const DANGEROUS_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file']);

/**
 * Accepts http(s) URLs AND mobile/desktop deep-link schemes
 * (e.g. `savi://paywall/success`, `myapp://checkout/done`). Replaces the
 * old hardcoded allowlist so apps can register their own scheme without
 * a gateway code change.
 */
export function IsRedirectUrl(opts?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isRedirectUrl',
      target: object.constructor,
      propertyName: propertyName as string,
      options: opts,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string' || value.length === 0) return false;
          const match = SCHEME_RE.exec(value);
          if (!match) return false;
          return !DANGEROUS_SCHEMES.has(match[1].toLowerCase());
        },
        defaultMessage() {
          return `${String(propertyName)} must be an http(s) URL or app deep link (e.g. https://… or savi://paywall/success)`;
        },
      },
    });
  };
}
