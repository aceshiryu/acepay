'use client';

import { useParams, useRouter } from 'next/navigation';
import { WebhookDetailPage } from '@/admin/pages/webhooks';
import { appPath } from '@/admin/app-scope';
import { useNavigate } from '@/admin/navigate';

export default function Page() {
  const params = useParams();
  const router = useRouter();
  const recordId = (params.recordId as string) ?? null;
  return (
    <WebhookDetailPage
      key={recordId ?? ''}
      evtId={recordId}
      onNavigate={useNavigate()}
      onBack={() => router.push(appPath(params.id as string, 'webhooks'))}
    />
  );
}
