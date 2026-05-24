'use client';

import { useRouter } from 'next/navigation';
import { IntegrationGuidePage } from '../../admin/pages/integrate';
import { useNavigate } from '../../admin/navigate';

/**
 * Public route — no auth guard. Renders the same IntegrationGuidePage the admin
 * uses. In-page CTAs like "Register App" still call useNavigate(), so authed
 * admins go straight to the destination and unauthed visitors land at /login
 * via the (admin) layout's auth gate.
 */
export default function Page() {
  const router = useRouter();
  return <IntegrationGuidePage onNavigate={useNavigate()} onBack={() => router.push('/')} />;
}
