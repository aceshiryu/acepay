'use client';

import { useParams, useRouter } from 'next/navigation';
import { MerchantDetailPage } from '@/admin/pages/merchants';
import { appPath } from '@/admin/app-scope';
import { useNavigate } from '@/admin/navigate';

export default function Page() {
  const params = useParams();
  const router = useRouter();
  const recordId = (params.recordId as string) ?? null;
  return (
    <MerchantDetailPage
      key={recordId ?? ''}
      merchantId={recordId}
      onNavigate={useNavigate()}
      onBack={() => router.push(appPath(params.id as string, 'merchants'))}
    />
  );
}
