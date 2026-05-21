// Static UI config + types still used by the layout/shared primitives.
// Live business data now flows through `./api/client.ts`.

export type NavItem = { id: string; label: string; icon: string; href: string };

export const NAV: NavItem[] = [
  { id: 'dashboard',     label: 'Dashboard',      icon: 'dash',  href: '/' },
  { id: 'apps',          label: 'Apps',           icon: 'apps',  href: '/apps' },
  { id: 'transactions',  label: 'Transactions',   icon: 'tx',    href: '/transactions' },
  { id: 'subscriptions', label: 'Subscriptions',  icon: 'sub',   href: '/subscriptions' },
  { id: 'plans',         label: 'Plans',          icon: 'spade', href: '/plans' },
  { id: 'customers',     label: 'Customers',      icon: 'cust',  href: '/customers' },
  { id: 'webhooks',      label: 'Webhook Events', icon: 'hook',  href: '/webhooks' },
  { id: 'logs',          label: 'Activity Logs',  icon: 'log',   href: '/logs' },
  { id: 'settings',      label: 'Settings',       icon: 'settings', href: '/settings' },
];

// Used by MovementTimeline in shared.tsx and re-emitted by transaction detail.
export interface MovementEvent {
  time: string;
  action: string;
  from: string | null;
  to: string;
  actor: string;
  detail: string;
}
