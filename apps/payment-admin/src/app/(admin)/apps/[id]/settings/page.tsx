'use client';

import { AppSettingsPage } from '@/admin/pages/app-overview';
import { useNavigate } from '@/admin/navigate';

export default function Page() {
  return <AppSettingsPage onNavigate={useNavigate()} />;
}
