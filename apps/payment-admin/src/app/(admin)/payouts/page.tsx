'use client';

import { PayoutsPage } from '../../../admin/pages/payouts';
import { useNavigate } from '../../../admin/navigate';

export default function Page() {
  return <PayoutsPage onNavigate={useNavigate()} />;
}
