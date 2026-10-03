'use client';

import { useParams, useRouter } from 'next/navigation';
import { MerchantDetailPage } from '../../../../admin/pages/merchants';
import { useNavigate } from '../../../../admin/navigate';

export default function Page() {
  const params = useParams();
  const router = useRouter();
  const merchantId = (params.id as string) ?? null;
  return (
    <MerchantDetailPage
      key={merchantId ?? ''}
      merchantId={merchantId}
      onNavigate={useNavigate()}
      onBack={() => router.push('/merchants')}
    />
  );
}
