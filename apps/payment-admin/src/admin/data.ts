// Static UI config + types still used by the layout/shared primitives.
// Live business data now flows through `./api/client.ts`.

export type NavItem = { id: string; label: string; icon: string; href: string; tint: string; group: string };

// `tint` colours the icon chip in the rail; `group` draws a divider between sections.
export const NAV: NavItem[] = [
  { id: 'dashboard',     label: 'Dashboard',      icon: 'dash',     href: '/dashboard',     tint: '#4F7CF7', group: 'overview' },
  { id: 'gateways',      label: 'Gateways',       icon: 'card',     href: '/gateways',      tint: '#7C5CF5', group: 'overview' },
  { id: 'apps',          label: 'Apps',           icon: 'apps',     href: '/apps',          tint: '#E8559B', group: 'overview' },
  { id: 'transactions',  label: 'Transactions',   icon: 'tx',       href: '/transactions',  tint: '#1FB563', group: 'billing' },
  { id: 'subscriptions', label: 'Subscriptions',  icon: 'sub',      href: '/subscriptions', tint: '#0EA5E9', group: 'billing' },
  { id: 'plans',         label: 'Plans',          icon: 'spade',    href: '/plans',         tint: '#F59E0B', group: 'billing' },
  { id: 'customers',     label: 'Customers',      icon: 'cust',     href: '/customers',     tint: '#14B8A6', group: 'billing' },
  { id: 'marketplace',   label: 'Marketplace',    icon: 'web',      href: '/marketplace',   tint: '#6C5CE7', group: 'marketplace' },
  { id: 'merchants',     label: 'Merchants',      icon: 'store',    href: '/merchants',     tint: '#F97316', group: 'marketplace' },
  { id: 'payouts',       label: 'Payouts',        icon: 'arrowUp',  href: '/payouts',       tint: '#22C55E', group: 'marketplace' },
  { id: 'webhooks',      label: 'Webhook Events', icon: 'hook',     href: '/webhooks',      tint: '#EF4444', group: 'system' },
  { id: 'logs',          label: 'Activity Logs',  icon: 'log',      href: '/logs',          tint: '#64748B', group: 'system' },
  { id: 'settings',      label: 'Settings',       icon: 'settings', href: '/settings',      tint: '#64748B', group: 'system' },
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
