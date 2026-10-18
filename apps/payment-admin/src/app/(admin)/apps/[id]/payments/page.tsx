'use client';

import { TransactionsPage } from '@/admin/pages/transactions';
import { useNavigate } from '@/admin/navigate';

export default function Page() {
  return <TransactionsPage onNavigate={useNavigate()} view="payments" />;
}
