/**
 * The Philippine payment methods a Xendit checkout can offer, by group, with
 * the codes Xendit uses for them (the `payment_methods` list on an invoice).
 * An app's setting is a list of these codes; null means "every method the
 * Xendit account has switched on".
 *
 * Grouped because people choose by kind ("e-wallets and QR Ph"), and because
 * refunds differ by kind: Xendit refunds cards and e-wallets online, but not
 * QR Ph or over-the-counter payments.
 */
export interface PaymentMethodGroup {
  key: 'ewallet' | 'qr' | 'card' | 'online_banking' | 'retail' | 'paylater';
  label: string;
  codes: readonly string[];
  /** Xendit can refund these online; the rest need a refund by hand. */
  refundableOnline: boolean;
}

export const PAYMENT_METHOD_GROUPS: readonly PaymentMethodGroup[] = [
  { key: 'ewallet', label: 'E-wallets (GCash, Maya, GrabPay, ShopeePay)', codes: ['GCASH', 'PAYMAYA', 'GRABPAY', 'SHOPEEPAY'], refundableOnline: true },
  { key: 'qr', label: 'QR Ph', codes: ['QRPH'], refundableOnline: false },
  { key: 'card', label: 'Credit and debit cards', codes: ['CREDIT_CARD'], refundableOnline: true },
  {
    key: 'online_banking',
    label: 'Online banking and direct debit',
    codes: [
      'DD_BPI', 'DD_UBP', 'DD_RCBC', 'DD_CHINABANK', 'DD_BDO_EPAY',
      'DD_BPI_ONLINE_BANKING', 'DD_BDO_ONLINE_BANKING', 'DD_UNIONBANK_ONLINE_BANKING', 'DD_RCBC_ONLINE_BANKING',
      'DD_CHINABANK_ONLINE_BANKING', 'DD_METROBANK_ONLINE_BANKING', 'DD_LANDBANK_ONLINE_BANKING', 'DD_PNB_ONLINE_BANKING',
      'DD_PSBANK_ONLINE_BANKING', 'DD_SECURITY_BANK_ONLINE_BANKING', 'DD_MAYBANK_ONLINE_BANKING', 'DD_BOC_ONLINE_BANKING',
      'DD_ROBINSONS_BANK_ONLINE_BANKING', 'DD_INSTAPAY_ONLINE_BANKING', 'DD_PESONET_ONLINE_BANKING',
    ],
    refundableOnline: false,
  },
  { key: 'retail', label: 'Over the counter (7-Eleven, Cebuana, LBC, …)', codes: ['7ELEVEN', 'CEBUANA', 'DP_MLHUILLIER', 'DP_PALAWAN', 'DP_ECPAY_LOAN', 'LBC'], refundableOnline: false },
  { key: 'paylater', label: 'Pay later (BillEase, Cashalo)', codes: ['BILLEASE', 'CASHALO'], refundableOnline: false },
];

export const ALL_PAYMENT_METHOD_CODES: readonly string[] = PAYMENT_METHOD_GROUPS.flatMap((g) => g.codes);

/**
 * The stored setting, cleaned: known codes only, no repeats, in catalogue
 * order. An empty or missing list means every method (null).
 */
export function normalizePaymentMethods(codes: readonly string[] | null | undefined): string[] | null {
  if (!codes || codes.length === 0) return null;
  const wanted = new Set(codes.map((c) => c.trim().toUpperCase()));
  const kept = ALL_PAYMENT_METHOD_CODES.filter((c) => wanted.has(c));
  return kept.length > 0 ? kept : null;
}

/**
 * The channel a Xendit invoice was paid with ("QRPH", "GCASH", "CREDIT_CARD",
 * …), from the invoice callback or the invoice itself; null when unknown.
 */
export function paymentChannelOf(raw: Record<string, unknown> | null | undefined): string | null {
  if (!raw) return null;
  const channel = raw['payment_channel'] ?? raw['paymentChannel'];
  if (typeof channel === 'string' && channel.trim()) return channel.trim().toUpperCase();
  const method = raw['payment_method'] ?? raw['paymentMethod'];
  // A card payment reports its method, not a channel.
  if (typeof method === 'string' && method.toUpperCase() === 'CREDIT_CARD') return 'CREDIT_CARD';
  return null;
}

/**
 * Can Xendit refund a payment made on this channel online? Cards and
 * e-wallets yes; QR Ph, over-the-counter, online banking and pay-later no.
 * null when the channel is unknown (an older payment): let Xendit decide.
 */
export function isRefundableOnline(channel: string | null | undefined): boolean | null {
  if (!channel) return null;
  const group = PAYMENT_METHOD_GROUPS.find((g) => g.codes.includes(channel.toUpperCase()));
  if (group) return group.refundableOnline;
  return channel.toUpperCase().startsWith('DD_') ? false : null;
}
