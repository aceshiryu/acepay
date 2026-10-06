import { isWebhookUrl } from './is-webhook-url';

describe('isWebhookUrl', () => {
  const OLD_ENV = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = OLD_ENV; });

  describe('outside production', () => {
    beforeEach(() => { process.env.NODE_ENV = 'development'; });

    it.each([
      'http://localhost:4100/webhooks/acepay',
      'http://localhost/webhooks',
      'http://127.0.0.1:3001/hook',
      'https://api.booklyph.com/webhooks/acepay',
    ])('accepts %s', (url) => {
      expect(isWebhookUrl(url)).toBe(true);
    });
  });

  describe('in production', () => {
    beforeEach(() => { process.env.NODE_ENV = 'production'; });

    it('accepts a real domain', () => {
      expect(isWebhookUrl('https://api.booklyph.com/webhooks/acepay')).toBe(true);
    });

    it('rejects localhost', () => {
      expect(isWebhookUrl('http://localhost:4100/webhooks/acepay')).toBe(false);
    });
  });

  it.each([
    ['no protocol', 'localhost:4100/webhooks'],
    ['non-http scheme', 'ftp://example.com/hook'],
    ['javascript', 'javascript://alert(1)'],
    ['not a string', 42],
    ['empty', ''],
  ])('rejects %s', (_label, value) => {
    process.env.NODE_ENV = 'development';
    expect(isWebhookUrl(value)).toBe(false);
  });
});
