'use client';

import { MerchantsPage } from '../../../admin/pages/merchants';
import { useNavigate } from '../../../admin/navigate';

export default function Page() {
  return <MerchantsPage onNavigate={useNavigate()} />;
}
