'use client';

import { useParams, useRouter } from 'next/navigation';
import { SubscriptionDetailPage } from '@/admin/pages/subscriptions';
import { appPath } from '@/admin/app-scope';
import { useNavigate } from '@/admin/navigate';

export default function Page() {
  const params = useParams();
  const router = useRouter();
  const recordId = (params.recordId as string) ?? null;
  return (
    <SubscriptionDetailPage
      key={recordId ?? ''}
      subId={recordId}
      onNavigate={useNavigate()}
      onBack={() => router.push(appPath(params.id as string, 'subscriptions'))}
    />
  );
}
