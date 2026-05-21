'use client';

import { PlansPage } from '../../../admin/pages/plans';
import { useNavigate } from '../../../admin/navigate';

export default function Page() {
  return <PlansPage onNavigate={useNavigate()} />;
}
