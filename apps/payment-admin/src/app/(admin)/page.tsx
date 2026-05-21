'use client';

import { DashboardPage } from '../../admin/pages/dashboard';
import { useNavigate } from '../../admin/navigate';

export default function Page() {
  return <DashboardPage onNavigate={useNavigate()} />;
}
