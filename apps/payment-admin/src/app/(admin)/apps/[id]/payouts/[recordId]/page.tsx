'use client';

import { useParams, useRouter } from 'next/navigation';
import { PayoutRunDetailPage } from '@/admin/pages/payouts';
import { appPath } from '@/admin/app-scope';
import { useNavigate } from '@/admin/navigate';

export default function Page() {
  const params = useParams();
  const router = useRouter();
  const recordId = (params.recordId as string) ?? null;
  return (
    <PayoutRunDetailPage
      key={recordId ?? ''}
      runId={recordId}
      onNavigate={useNavigate()}
      onBack={() => router.push(appPath(params.id as string, 'payouts'))}
    />
  );
}
