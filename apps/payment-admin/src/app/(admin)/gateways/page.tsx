'use client';

import { GatewaysPage } from '../../../admin/pages/gateways';
import { useNavigate } from '../../../admin/navigate';

export default function Page() {
  return <GatewaysPage onNavigate={useNavigate()} />;
}
