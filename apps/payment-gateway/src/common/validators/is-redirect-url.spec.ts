import { validate } from 'class-validator';
import { IsRedirectUrl } from './is-redirect-url';

class Dto {
  @IsRedirectUrl()
  redirectUrl!: unknown;
}

/** Returns true when the value passes IsRedirectUrl. */
async function accepts(value: unknown): Promise<boolean> {
  const dto = new Dto();
  dto.redirectUrl = value;
  const errors = await validate(dto);
  return errors.length === 0;
}

describe('IsRedirectUrl', () => {
  describe('accepts legitimate redirect targets', () => {
    it.each([
      'https://savi.app/paywall/success',
      'http://localhost:4000/done',
      'https://example.com/path?query=1&other=2#frag',
      // Deep links — the whole point of dropping the http-only allowlist.
      'savi://paywall/success',
      'myapp://checkout/done',
      'com.acecerio.savi://callback',
      // RFC 3986 permits + . - inside a scheme.
      'my-app.v2+beta://done',
      // Single-character scheme.
      'x://y',
    ])('accepts %s', async (value) => {
      await expect(accepts(value)).resolves.toBe(true);
    });
  });

  describe('rejects code-executing / local-file schemes', () => {
    it.each([
      'javascript://alert(1)',
      'data://text/html;base64,PHNjcmlwdD4=',
      'vbscript://msgbox(1)',
      'file:///etc/passwd',
    ])('rejects %s', async (value) => {
      await expect(accepts(value)).resolves.toBe(false);
    });

    // The scheme regex is case-insensitive, so the dangerous-scheme check must
    // normalize case or `JaVaScRiPt://` would sail straight through.
    it.each([
      'JAVASCRIPT://alert(1)',
      'JavaScript://alert(1)',
      'DATA://text/html,x',
      'FILE:///etc/passwd',
      'VbScript://x',
    ])('rejects %s regardless of case', async (value) => {
      await expect(accepts(value)).resolves.toBe(false);
    });

    // `javascript:alert(1)` is the form that actually executes in a browser —
    // it has no `//`, so the `://` requirement is what blocks it.
    it.each([
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
    ])('rejects the scheme-only form %s', async (value) => {
      await expect(accepts(value)).resolves.toBe(false);
    });

    // Browsers strip tabs/newlines inside a scheme; the regex must not let a
    // split scheme through as some other "valid" scheme.
    it.each([
      'java\tscript://alert(1)',
      'java\nscript://alert(1)',
      'java\rscript://alert(1)',
      'jav\0ascript://alert(1)',
    ])('rejects whitespace-obfuscated %j', async (value) => {
      await expect(accepts(value)).resolves.toBe(false);
    });
  });

  describe('rejects malformed values', () => {
    it.each([
      ['no scheme at all', 'example.com/path'],
      ['protocol-relative', '//example.com/path'],
      ['absolute path', '/paywall/success'],
      ['relative path', '../success'],
      ['scheme with no authority/path', 'https://'],
      ['bare scheme separator', '://example.com'],
      ['scheme starting with a digit', '1app://done'],
      ['scheme starting with a symbol', '_app://done'],
      ['scheme containing a space', 'my app://done'],
      ['leading whitespace', ' https://example.com'],
      ['leading newline', '\nhttps://example.com'],
      ['empty string', ''],
      ['whitespace only', '   '],
    ])('rejects %s', async (_label, value) => {
      await expect(accepts(value)).resolves.toBe(false);
    });

    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a number', 12345],
      ['a boolean', true],
      ['an object', { url: 'https://example.com' }],
      ['an array', ['https://example.com']],
      // A String object is not a primitive string — typeof is 'object'.
      ['a String object', new String('https://example.com')],
    ])('rejects %s (non-string)', async (_label, value) => {
      await expect(accepts(value)).resolves.toBe(false);
    });
  });

  it('accepts a very long but structurally valid URL', async () => {
    await expect(accepts(`https://example.com/${'a'.repeat(2000)}`)).resolves.toBe(true);
  });

  it('explains what a valid value looks like when it fails', async () => {
    const dto = new Dto();
    dto.redirectUrl = 'not-a-url';
    const [error] = await validate(dto);
    const message = Object.values(error.constraints ?? {}).join(' ');
    expect(message).toContain('redirectUrl');
    expect(message).toMatch(/deep link/i);
  });
});
