'use client';

import { NotificationsPage } from '../../../admin/pages/notifications';
import { useNavigate } from '../../../admin/navigate';

export default function Page() {
  return <NotificationsPage onNavigate={useNavigate()} />;
}
