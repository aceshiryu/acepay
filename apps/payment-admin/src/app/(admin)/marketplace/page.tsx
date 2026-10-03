'use client';

import { MarketplacePage } from '../../../admin/pages/marketplace';
import { useNavigate } from '../../../admin/navigate';

export default function Page() {
  return <MarketplacePage onNavigate={useNavigate()} />;
}
