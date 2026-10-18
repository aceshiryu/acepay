'use client';

import { useParams, useRouter } from 'next/navigation';
import { TransactionDetailPage } from '@/admin/pages/transactions';
import { appPath } from '@/admin/app-scope';
import { useNavigate } from '@/admin/navigate';

export default function Page() {
  const params = useParams();
  const router = useRouter();
  const recordId = (params.recordId as string) ?? null;
  return (
    <TransactionDetailPage
      key={recordId ?? ''}
      txId={recordId}
      onNavigate={useNavigate()}
      onBack={() => router.push(appPath(params.id as string, 'payments'))}
    />
  );
}
