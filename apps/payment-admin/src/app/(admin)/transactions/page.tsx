'use client';

import { useSearchParams } from 'next/navigation';
import { RedirectTo } from '@/admin/redirects';

/** Replaced by /apps/<id>/payments; `?app=` is honoured. */
export default function Page() {
  const app = useSearchParams()?.get('app');
  return <RedirectTo href={app ? `/apps/${app}/payments` : '/dashboard'} />;
}
