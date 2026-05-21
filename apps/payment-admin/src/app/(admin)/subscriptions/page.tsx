'use client';

import { SubscriptionsPage } from '../../../admin/pages/subscriptions';
import { useNavigate } from '../../../admin/navigate';

export default function Page() {
  return <SubscriptionsPage onNavigate={useNavigate()} />;
}
