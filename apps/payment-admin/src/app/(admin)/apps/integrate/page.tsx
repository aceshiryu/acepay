'use client';

import { useRouter } from 'next/navigation';
import { IntegrationGuidePage } from '../../../../admin/pages/integrate';
import { useNavigate } from '../../../../admin/navigate';

export default function Page() {
  const router = useRouter();
  return <IntegrationGuidePage onNavigate={useNavigate()} onBack={() => router.push('/apps')} />;
}
