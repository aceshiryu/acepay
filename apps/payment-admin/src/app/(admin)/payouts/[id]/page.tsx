'use client';

import { useParams, useRouter } from 'next/navigation';
import * as api from '@/admin/api/client';
import { useNavigate } from '@/admin/navigate';
import { PayoutRunDetailPage } from '@/admin/pages/payouts';
import { RecordRedirect } from '@/admin/redirects';

/** Old global URL. Runs started for one app move under it; all-apps runs stay here. */
export default function Page() {
  const params = useParams();
  const router = useRouter();
  const navigate = useNavigate();
  const id = (params.id as string) ?? null;
  return (
    <RecordRedirect
      recordId={id}
      segment="payouts"
      load={() => api.payoutRuns.one(id ?? '')}
      fallback={<PayoutRunDetailPage key={id ?? ''} runId={id} onNavigate={navigate} onBack={() => router.push('/dashboard')} />}
    />
  );
}
