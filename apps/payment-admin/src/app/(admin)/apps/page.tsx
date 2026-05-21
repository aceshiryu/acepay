'use client';

import { AppsPage } from '../../../admin/pages/apps';
import { useNavigate } from '../../../admin/navigate';

export default function Page() {
  return <AppsPage onNavigate={useNavigate()} />;
}
