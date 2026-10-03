import { TransactionStatus } from '../enums';
import {
  formatCurrencyTotals,
  grossRevenueByCurrency,
  netRevenueByCurrency,
} from './revenue';

describe('revenue rollup (F1)', () => {
  describe('netRevenueByCurrency', () => {
    it('keeps currencies separate — never sums PHP and USD together', () => {
      const out = netRevenueByCurrency([
        { currency: 'PHP', status: TransactionStatus.Succeeded, amount: 29900 },
        { currency: 'USD', status: TransactionStatus.Succeeded, amount: 4900 },
      ]);
      expect(out).toEqual([
        { currency: 'PHP', amount: 29900 },
        { currency: 'USD', amount: 4900 },
      ]);
    });

    it('subtracts refunds from revenue instead of adding them', () => {
      const out = netRevenueByCurrency([
        { currency: 'PHP', status: TransactionStatus.Succeeded, amount: 100000 },
        { currency: 'PHP', status: TransactionStatus.Refunded, amount: 30000 },
      ]);
      expect(out).toEqual([{ currency: 'PHP', amount: 70000 }]);
    });

    it('ignores pending / failed / canceled transactions', () => {
      const out = netRevenueByCurrency([
        { currency: 'PHP', status: TransactionStatus.Succeeded, amount: 500 },
        { currency: 'PHP', status: TransactionStatus.Pending, amount: 999 },
        { currency: 'PHP', status: TransactionStatus.Failed, amount: 999 },
        { currency: 'PHP', status: TransactionStatus.Canceled, amount: 999 },
      ]);
      expect(out).toEqual([{ currency: 'PHP', amount: 500 }]);
    });

    it('normalizes currency case and coerces string amounts (SUM() returns text)', () => {
      const out = netRevenueByCurrency([
        { currency: 'php', status: TransactionStatus.Succeeded, amount: '100' },
        { currency: 'PHP', status: TransactionStatus.Succeeded, amount: '200' },
      ]);
      expect(out).toEqual([{ currency: 'PHP', amount: 300 }]);
    });

    it('skips rows with no currency', () => {
      const out = netRevenueByCurrency([
        { currency: '', status: TransactionStatus.Succeeded, amount: 100 },
      ]);
      expect(out).toEqual([]);
    });
  });

  describe('grossRevenueByCurrency', () => {
    it('counts only succeeded, ignoring refunds', () => {
      const out = grossRevenueByCurrency([
        { currency: 'PHP', status: TransactionStatus.Succeeded, amount: 100 },
        { currency: 'PHP', status: TransactionStatus.Refunded, amount: 50 },
      ]);
      expect(out).toEqual([{ currency: 'PHP', amount: 100 }]);
    });
  });

  describe('formatCurrencyTotals', () => {
    it('renders each currency explicitly in major units', () => {
      expect(formatCurrencyTotals([
        { currency: 'PHP', amount: 129900 },
        { currency: 'USD', amount: 4900 },
      ])).toBe('PHP 1,299.00 + USD 49.00');
    });

    it('renders 0 for an empty rollup', () => {
      expect(formatCurrencyTotals([])).toBe('0');
    });
  });
});
