'use client';

import { RedirectTo } from '@/admin/redirects';

/** Each provider now has its own config page. */
export default function Page() {
  return <RedirectTo href="/providers/lemonsqueezy" />;
}
