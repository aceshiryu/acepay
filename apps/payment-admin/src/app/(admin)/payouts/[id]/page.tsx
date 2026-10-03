'use client';

import { useParams, useRouter } from 'next/navigation';
import { PayoutRunDetailPage } from '../../../../admin/pages/payouts';
import { useNavigate } from '../../../../admin/navigate';

export default function Page() {
  const params = useParams();
  const router = useRouter();
  const runId = (params.id as string) ?? null;
  return (
    <PayoutRunDetailPage
      key={runId ?? ''}
      runId={runId}
      onNavigate={useNavigate()}
      onBack={() => router.push('/payouts')}
    />
  );
}
