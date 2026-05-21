'use client';

import { SettingsPage } from '../../../admin/pages/settings';
import { useNavigate } from '../../../admin/navigate';

export default function Page() {
  return <SettingsPage onNavigate={useNavigate()} />;
}
