'use client';

import { useRouter } from 'next/navigation';
import { RegisterAppPage } from '../../../../admin/pages/register-app';
import { useNavigate } from '../../../../admin/navigate';

export default function Page() {
  const router = useRouter();
  return <RegisterAppPage onNavigate={useNavigate()} onBack={() => router.push('/apps')} />;
}
