'use client';

import { AppOverviewPage } from '@/admin/pages/app-overview';
import { useNavigate } from '@/admin/navigate';

export default function Page() {
  return <AppOverviewPage onNavigate={useNavigate()} />;
}
