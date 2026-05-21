'use client';

import { useSearchParams } from 'next/navigation';
import { TransactionsPage } from '../../../admin/pages/transactions';
import { useNavigate } from '../../../admin/navigate';

export default function Page() {
  const search = useSearchParams();
  const filterApp = search?.get('app') ?? null;
  return <TransactionsPage onNavigate={useNavigate()} filterApp={filterApp} />;
}
