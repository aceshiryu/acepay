import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LoginDto } from './login.dto';

function errorsFor(body: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(LoginDto, body)).map((e) => e.property);
}

const VALID = { email: 'admin@acepay.dev', password: 'correct-horse' };

describe('LoginDto', () => {
  it('accepts a well-formed credential pair', () => {
    expect(errorsFor(VALID)).toEqual([]);
  });

  describe('email', () => {
    it.each([
      ['a plain address', 'admin@acepay.dev'],
      ['a subdomain address', 'ops@mail.acepay.dev'],
      ['a plus-tagged address', 'admin+ci@acepay.dev'],
      ['an uppercase address', 'ADMIN@ACEPAY.DEV'],
    ])('accepts %s', (_label, email) => {
      expect(errorsFor({ ...VALID, email })).toEqual([]);
    });

    it.each([
      ['missing', undefined],
      ['null', null],
      ['empty', ''],
      ['no @', 'adminacepay.dev'],
      ['no domain', 'admin@'],
      ['no local part', '@acepay.dev'],
      ['whitespace only', '   '],
      ['a bare word', 'admin'],
      ['two @ signs', 'a@b@acepay.dev'],
      ['a number', 12345],
      ['an object', { email: 'a@b.c' }],
    ])('rejects an email that is %s', (_label, email) => {
      expect(errorsFor({ ...VALID, email })).toContain('email');
    });
  });

  describe('password', () => {
    it('accepts exactly the 8-character minimum', () => {
      expect(errorsFor({ ...VALID, password: '12345678' })).toEqual([]);
    });

    it('rejects one character under the minimum', () => {
      expect(errorsFor({ ...VALID, password: '1234567' })).toContain('password');
    });

    it.each([
      ['missing', undefined],
      ['null', null],
      ['empty', ''],
      ['a number', 12345678],
      ['a boolean', true],
      ['an array', ['12345678']],
    ])('rejects a password that is %s', (_label, password) => {
      expect(errorsFor({ ...VALID, password })).toContain('password');
    });

    it('accepts a long passphrase with spaces and symbols', () => {
      expect(errorsFor({ ...VALID, password: 'correct horse battery staple !@#$%^&*()' })).toEqual([]);
    });

    // MinLength counts characters, not bytes — a short multi-byte password must
    // not sneak past on byte length.
    it('rejects a multi-byte password under 8 characters', () => {
      expect(errorsFor({ ...VALID, password: 'パスワード' })).toContain('password');
    });
  });

  it('reports both fields when both are wrong', () => {
    expect(errorsFor({ email: 'nope', password: 'short' }))
      .toEqual(expect.arrayContaining(['email', 'password']));
  });

  it('reports both fields for an entirely empty body', () => {
    expect(errorsFor({})).toEqual(expect.arrayContaining(['email', 'password']));
  });
});
