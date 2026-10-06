import { codesFor, groupsOf, METHOD_GROUPS } from '../src/admin/pages/app-payment-methods';

describe('payment methods card — what is stored', () => {
  it('e-wallets and QR Ph become their Xendit codes', () => {
    expect(codesFor(new Set(['ewallet', 'qr']))).toEqual(['GCASH', 'PAYMAYA', 'GRABPAY', 'SHOPEEPAY', 'QRPH']);
  });

  it('every group ticked is stored as "every method" (null)', () => {
    expect(codesFor(new Set(METHOD_GROUPS.map((g) => g.key)))).toBeNull();
  });

  it('reads a stored list back as the groups it switches on', () => {
    expect([...groupsOf(['GCASH', 'QRPH'])].sort()).toEqual(['ewallet', 'qr']);
    expect(groupsOf(null).size).toBe(METHOD_GROUPS.length);
  });
});
