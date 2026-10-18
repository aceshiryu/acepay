import { redirect } from 'next/navigation';

// Settings became the per-provider config pages; keep old bookmarks working.
export default function Page() {
  redirect('/providers/lemonsqueezy');
}
