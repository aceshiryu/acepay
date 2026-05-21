'use client';

import { ActivityLogsPage } from '../../../admin/pages/logs';
import { useNavigate } from '../../../admin/navigate';

export default function Page() {
  return <ActivityLogsPage onNavigate={useNavigate()} />;
}
