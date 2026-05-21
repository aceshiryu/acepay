'use client';

import React from 'react';
import * as api from '../api/client';
import { formatRelative } from '../api/format';
import { LoadingBlock } from '../api/loading-states';
import { useFetch } from '../api/use-fetch';
import { useReadSet } from '../api/use-read-set';
import { Notification, NotificationSeverity } from '../api/types';
import { PageShell } from '../layout';
import { Button, Card, Icon, AppAvatar } from '../primitives';
import { Navigate } from '../types';

const READ_STORAGE_KEY = 'acepay.admin.readNotifications';

export function NotificationsPage({ onNavigate }: { onNavigate: Navigate }) {
  const [filter, setFilter] = React.useState<'all' | 'unread' | 'critical'>('all');
  const list = useFetch(() => api.notifications.list({ pageSize: 100 }), []);
  const stats = useFetch(() => api.notifications.stats(), []);
  const { isRead, markRead, markAllRead } = useReadSet(READ_STORAGE_KEY);

  const allNotifs = list.data?.data ?? [];
  const unreadCount = allNotifs.filter((n) => !isRead(n.id)).length;
  const criticalCount = stats.data?.critical ?? 0;

  const filtered = allNotifs.filter((n) => {
    if (filter === 'unread') return !isRead(n.id);
    if (filter === 'critical') return n.severity === 'critical';
    return true;
  });

  const groups: { key: string; label: string; items: Notification[] }[] = (() => {
    const today: Notification[] = [];
    const yesterday: Notification[] = [];
    const earlier: Notification[] = [];
    const now = new Date();
    const dayMs = 86_400_000;
    for (const n of filtered) {
      const ageMs = now.getTime() - new Date(n.createdAt).getTime();
      if (ageMs < dayMs) today.push(n);
      else if (ageMs < 2 * dayMs) yesterday.push(n);
      else earlier.push(n);
    }
    return [
      { key: 'today', label: 'Today', items: today },
      { key: 'yesterday', label: 'Yesterday', items: yesterday },
      { key: 'earlier', label: 'Earlier', items: earlier },
    ];
  })();

  return (
    <PageShell
      title="Notifications"
      breadcrumbs={[{ label: 'Inbox' }, { label: 'Notifications' }]}
      actions={
        <>
          <Button
            variant="secondary" size="md" leading={<Icon name="refresh" size={12} />}
            onClick={() => { list.refetch(); stats.refetch(); }}
          >Refresh</Button>
          <Button
            variant="secondary" size="md"
            onClick={() => markAllRead(allNotifs.map((n) => n.id))}
            leading={<Icon name="check" size={12} strokeWidth={2.4} />}
          >Mark all read</Button>
        </>
      }
    >
      <div style={{ maxWidth: 880 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          marginBottom: 14, padding: 3,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, width: 'fit-content',
        }}>
          <SegBtn label="All"      count={allNotifs.length}   active={filter === 'all'}      onClick={() => setFilter('all')} />
          <SegBtn label="Unread"   count={unreadCount}        active={filter === 'unread'}   onClick={() => setFilter('unread')} />
          <SegBtn label="Critical" count={criticalCount}      active={filter === 'critical'} onClick={() => setFilter('critical')} />
        </div>

        {list.loading && <LoadingBlock height={140} />}
        {list.error && <div style={{ padding: 16, color: 'var(--bad)' }}>{list.error.message}</div>}
        {list.data && filtered.length === 0 && (
          <Card padding={32}>
            <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
              <Icon name="bell" size={28} color="var(--muted-2)" />
              <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', marginTop: 10 }}>
                You&apos;re all caught up
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                No {filter === 'all' ? '' : filter} notifications to show.
              </div>
            </div>
          </Card>
        )}

        {list.data && filtered.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
            {groups.map((g) => g.items.length === 0 ? null : (
              <div key={g.key}>
                <div style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--muted)',
                  textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, paddingLeft: 2,
                }}>{g.label}</div>
                <Card padding={0}>
                  {g.items.map((n, i) => (
                    <NotifRow
                      key={n.id}
                      notif={n}
                      unread={!isRead(n.id)}
                      last={i === g.items.length - 1}
                      onMarkRead={() => markRead(n.id)}
                      onOpen={() => {
                        markRead(n.id);
                        if (n.link) onNavigate(n.link.page, n.link.param);
                      }}
                    />
                  ))}
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

function SegBtn({ label, count, active, onClick }: {
  label: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '5px 11px', borderRadius: 6, border: 'none',
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--accent-ink)' : 'var(--ink-2)',
        fontSize: 12, fontWeight: 550, cursor: 'pointer',
        transition: 'all 100ms',
      }}
    >
      {label}
      <span style={{
        fontSize: 10.5, fontWeight: 600,
        padding: '1px 6px', borderRadius: 999,
        background: active ? 'rgba(255,255,255,0.18)' : 'var(--surface-2)',
        color: active ? 'var(--accent-ink)' : 'var(--muted)',
      }}>{count}</span>
    </button>
  );
}

function NotifRow({ notif, unread, last, onOpen, onMarkRead }: {
  notif: Notification;
  unread: boolean;
  last: boolean;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const sev = severityStyle(notif.severity);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '32px 1fr auto',
      gap: 14, alignItems: 'flex-start',
      padding: '14px 16px 14px 13px',
      borderBottom: last ? 'none' : '1px solid var(--hairline)',
      borderLeft: '3px solid', borderLeftColor: unread ? 'var(--accent)' : 'transparent',
      background: 'transparent',
      transition: 'background 100ms, border-color 100ms',
    }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 8,
        background: sev.bg, color: sev.fg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <Icon name={sev.icon} size={14} color={sev.fg} strokeWidth={2.2} />
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: unread ? 600 : 550, color: 'var(--ink)' }}>{notif.title}</div>
          {notif.app && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--muted)' }}>
              <AppAvatar name={notif.app.name} size={14} />
              {notif.app.name}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4, lineHeight: 1.5 }}>
          {notif.body}
        </div>
        {notif.link && (
          <button
            onClick={onOpen}
            style={{
              background: 'none', border: 'none', padding: 0, marginTop: 6,
              fontSize: 11.5, color: 'var(--accent)', fontWeight: 550, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            {notif.link.label} <Icon name="arrow" size={11} strokeWidth={2} />
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {formatRelative(notif.createdAt)}
        </span>
        {unread && (
          <button
            onClick={onMarkRead}
            style={{
              background: 'none', border: 'none', padding: 0,
              fontSize: 11, color: 'var(--muted)', cursor: 'pointer',
            }}
          >
            Mark read
          </button>
        )}
      </div>
    </div>
  );
}

function severityStyle(sev: NotificationSeverity): { fg: string; bg: string; icon: string } {
  switch (sev) {
    case 'critical': return { fg: 'var(--bad)',  bg: 'var(--bad-soft)',  icon: 'skull' };
    case 'warn':     return { fg: 'var(--warn)', bg: 'var(--warn-soft)', icon: 'warn' };
    case 'success':  return { fg: 'var(--ok)',   bg: 'var(--ok-soft)',   icon: 'check' };
    case 'info':
    default:         return { fg: 'var(--info)', bg: 'var(--info-soft)', icon: 'bell' };
  }
}
