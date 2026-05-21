'use client';

import { WebhooksPage } from '../../../admin/pages/webhooks';
import { useNavigate } from '../../../admin/navigate';

export default function Page() {
  return <WebhooksPage onNavigate={useNavigate()} />;
}
