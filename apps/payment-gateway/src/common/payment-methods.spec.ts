import { ALL_PAYMENT_METHOD_CODES, isRefundableOnline, normalizePaymentMethods, PAYMENT_METHOD_GROUPS, paymentChannelOf } from './payment-methods';

describe('payment methods', () => {
  it('keeps known codes only, once each, in catalogue order', () => {
    expect(normalizePaymentMethods(['qrph', 'GCASH', 'GCASH', 'NOPE'])).toEqual(['GCASH', 'QRPH']);
  });

  it('treats an empty or missing list as "every method"', () => {
    expect(normalizePaymentMethods([])).toBeNull();
    expect(normalizePaymentMethods(null)).toBeNull();
    expect(normalizePaymentMethods(['NOPE'])).toBeNull();
  });

  it('every code belongs to exactly one group', () => {
    expect(new Set(ALL_PAYMENT_METHOD_CODES).size).toBe(ALL_PAYMENT_METHOD_CODES.length);
    expect(PAYMENT_METHOD_GROUPS.find((g) => g.key === 'qr')?.refundableOnline).toBe(false);
  });
});

describe('payment channel', () => {
  it('reads the channel Xendit paid with', () => {
    expect(paymentChannelOf({ payment_channel: 'QRPH', payment_method: 'QR_CODE' })).toBe('QRPH');
    expect(paymentChannelOf({ payment_channel: 'gcash' })).toBe('GCASH');
    expect(paymentChannelOf({ payment_method: 'CREDIT_CARD' })).toBe('CREDIT_CARD');
    expect(paymentChannelOf({})).toBeNull();
  });

  it('knows which channels Xendit refunds online', () => {
    expect(isRefundableOnline('GCASH')).toBe(true);
    expect(isRefundableOnline('CREDIT_CARD')).toBe(true);
    expect(isRefundableOnline('QRPH')).toBe(false);
    expect(isRefundableOnline('7ELEVEN')).toBe(false);
    expect(isRefundableOnline('DD_NEW_BANK_ONLINE_BANKING')).toBe(false);
    expect(isRefundableOnline(null)).toBeNull();
  });
});
