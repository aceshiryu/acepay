'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Provider } from '@/admin/api/types';
import { useNavigate } from '@/admin/navigate';
import { DashboardPage } from '@/admin/pages/dashboard';
import { AddAppModal } from '@/admin/pages/register-app';
import { PROVIDERS } from '@/admin/provider-theme';

/** Add app opens as a modal over the dashboard, so the URL can be linked. */
export default function Page() {
  const router = useRouter();
  const navigate = useNavigate();
  const p = useSearchParams()?.get('provider') as Provider | null;
  return (
    <>
      <DashboardPage onNavigate={navigate} />
      <AddAppModal
        initialProvider={p && PROVIDERS.includes(p) ? p : null}
        onNavigate={navigate}
        onClose={() => router.push('/dashboard')}
      />
    </>
  );
}
