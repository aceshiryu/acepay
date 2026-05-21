'use client';

import { useParams, useRouter } from 'next/navigation';
import { SubscriptionDetailPage } from '../../../../admin/pages/subscriptions';
import { useNavigate } from '../../../../admin/navigate';

export default function Page() {
  const params = useParams();
  const router = useRouter();
  const subId = (params.id as string) ?? null;
  return (
    <SubscriptionDetailPage subId={subId} onNavigate={useNavigate()} onBack={() => router.push('/subscriptions')} />
  );
}
