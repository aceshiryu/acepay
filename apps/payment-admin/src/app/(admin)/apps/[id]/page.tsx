'use client';

import { useParams, useRouter } from 'next/navigation';
import { AppDetailPage } from '../../../../admin/pages/apps';
import { useNavigate } from '../../../../admin/navigate';

export default function Page() {
  const params = useParams();
  const router = useRouter();
  const appId = (params.id as string) ?? null;
  return (
    <AppDetailPage appId={appId} onNavigate={useNavigate()} onBack={() => router.push('/apps')} />
  );
}
