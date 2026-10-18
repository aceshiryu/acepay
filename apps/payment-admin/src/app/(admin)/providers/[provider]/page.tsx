'use client';

import { useParams } from 'next/navigation';
import { Provider } from '@/admin/api/types';
import { useNavigate } from '@/admin/navigate';
import { ProviderConfigPage } from '@/admin/pages/integrations';
import { PROVIDERS } from '@/admin/provider-theme';
import { RedirectTo } from '@/admin/redirects';

export default function Page() {
  const params = useParams();
  const navigate = useNavigate();
  const provider = params.provider as Provider;
  if (!PROVIDERS.includes(provider)) return <RedirectTo href="/providers/lemonsqueezy" />;
  return <ProviderConfigPage key={provider} provider={provider} onNavigate={navigate} />;
}
