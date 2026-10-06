import { DISPLAY_CODE_PREFIX, displayCodeColumn, displayCodeSql } from './display-code';

describe('display codes', () => {
  it('formats the sequence with the table prefix, zero-padded to 6', () => {
    expect(displayCodeSql('transactions')).toBe(
      `'TXN-' || lpad(nextval('transactions_code_seq')::text, 6, '0')`,
    );
  });

  // The migration creates exactly these sequence names; a typo here would make
  // every insert fail with "relation ..._code_seq does not exist".
  it.each(Object.keys(DISPLAY_CODE_PREFIX) as (keyof typeof DISPLAY_CODE_PREFIX)[])(
    '%s uses its own <table>_code_seq',
    (table) => {
      expect(displayCodeSql(table)).toContain(`nextval('${table}_code_seq')`);
    },
  );

  it('prefixes are unique so codes never collide across record types', () => {
    const prefixes = Object.values(DISPLAY_CODE_PREFIX);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('column is a DB default that the app never overwrites', () => {
    const col = displayCodeColumn('payouts');
    expect(col.update).toBe(false);
    expect(col.default()).toBe(displayCodeSql('payouts'));
  });
});
