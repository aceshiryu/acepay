'use client';

import React from 'react';
import * as api from '../api/client';
import { AppView } from '../api/types';
import { Button, Card } from '../primitives';

/**
 * The payment-method groups a checkout can offer, with Xendit's codes. Mirrors
 * the gateway's PAYMENT_METHOD_GROUPS (common/payment-methods.ts); the gateway
 * re-checks every code.
 */
export const METHOD_GROUPS: ReadonlyArray<{ key: string; label: string; codes: string[]; refundableOnline: boolean }> = [
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

/** The groups a stored list switches on (a group counts when any of its codes is in the list). */
export function groupsOf(codes: string[] | null | undefined): Set<string> {
  if (!codes || codes.length === 0) return new Set(METHOD_GROUPS.map((g) => g.key));
  const on = new Set(codes);
  return new Set(METHOD_GROUPS.filter((g) => g.codes.some((c) => on.has(c))).map((g) => g.key));
}

/** The list to store for the chosen groups; null when every group is chosen (= every method). */
export function codesFor(groups: Set<string>): string[] | null {
  if (groups.size === METHOD_GROUPS.length) return null;
  return METHOD_GROUPS.filter((g) => groups.has(g.key)).flatMap((g) => g.codes);
}

/**
 * Which payment methods this app's checkouts offer. Sent with every checkout:
 * Xendit's own dashboard setting does not reach the sub-accounts that
 * marketplace payments go through, so this is the one that counts.
 */
export function AppPaymentMethodsCard({ app, onSaved }: { app: AppView; onSaved: () => void }) {
  const [chosen, setChosen] = React.useState<Set<string>>(() => groupsOf(app.paymentMethods));
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  React.useEffect(() => setChosen(groupsOf(app.paymentMethods)), [app.paymentMethods]);

  const stored = groupsOf(app.paymentMethods);
  const changed = chosen.size !== stored.size || [...chosen].some((k) => !stored.has(k));
  const noOnlineRefund = METHOD_GROUPS.filter((g) => chosen.has(g.key) && !g.refundableOnline).map((g) => g.label);

  const toggle = (key: string) => {
    setMessage(null);
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    if (chosen.size === 0) {
      setMessage({ ok: false, text: 'Choose at least one payment method.' });
      return;
    }
    setSaving(true);
    try {
      await api.apps.update(app.id, { paymentMethods: codesFor(chosen) });
      setMessage({ ok: true, text: 'Saved. New checkouts offer only these methods.' });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Payment methods" subtitle="What customers can pay with on this app's checkout">
      <div style={{ display: 'grid', gap: 8 }} data-testid="app-payment-methods">
        {METHOD_GROUPS.map((g) => (
          <label key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
            <input type="checkbox" checked={chosen.has(g.key)} onChange={() => toggle(g.key)} data-testid={`method-${g.key}`} />
            <span>{g.label}</span>
            {!g.refundableOnline ? (
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>refunds by hand</span>
            ) : null}
          </label>
        ))}
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', margin: '10px 0 0' }}>
        {chosen.size === METHOD_GROUPS.length
          ? 'All methods: whatever the Xendit account has switched on.'
          : 'Only these are sent with each checkout. Xendit’s dashboard setting does not reach sub-accounts, so this is the one that counts.'}
        {noOnlineRefund.length > 0 ? ` Xendit cannot refund ${noOnlineRefund.join(', ')} online: the app refunds those by hand.` : ''}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <Button size="sm" onClick={() => void save()} disabled={!changed || saving}>
          {saving ? 'Saving…' : 'Save payment methods'}
        </Button>
        {message ? (
          <span role="status" style={{ fontSize: 12, color: message.ok ? 'var(--ok)' : 'var(--bad)' }}>
            {message.text}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
