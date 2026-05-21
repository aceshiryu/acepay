'use client';

import { useParams, useRouter } from 'next/navigation';
import { WebhookDetailPage } from '../../../../admin/pages/webhooks';
import { useNavigate } from '../../../../admin/navigate';

export default function Page() {
  const params = useParams();
  const router = useRouter();
  const evtId = (params.id as string) ?? null;
  return (
    <WebhookDetailPage evtId={evtId} onNavigate={useNavigate()} onBack={() => router.push('/webhooks')} />
  );
}
