'use client';

import { useParams, useRouter } from 'next/navigation';
import { TransactionDetailPage } from '../../../../admin/pages/transactions';
import { useNavigate } from '../../../../admin/navigate';

export default function Page() {
  const params = useParams();
  const router = useRouter();
  const txId = (params.id as string) ?? null;
  return (
    <TransactionDetailPage txId={txId} onNavigate={useNavigate()} onBack={() => router.push('/transactions')} />
  );
}
