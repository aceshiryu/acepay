'use client';

import { RedirectTo } from '@/admin/redirects';

/** Replaced by the per-app pages under /apps/<id>/. */
export default function Page() {
  return <RedirectTo href="/dashboard" />;
}
