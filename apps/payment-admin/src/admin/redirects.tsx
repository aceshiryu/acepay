'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { appPath } from './app-scope';

function Notice({ text, error }: { text: string; error?: boolean }) {
  return (
    <div style={{ padding: 40, fontSize: 13, color: error ? 'var(--bad)' : 'var(--muted)' }}>{text}</div>
  );
}

/** Client-side redirect for URLs the app-centric layout replaced. */
export function RedirectTo({ href }: { href: string }) {
  const router = useRouter();
  React.useEffect(() => { router.replace(href); }, [router, href]);
  return <Notice text="Redirecting…" />;
}

/**
 * Old global record URLs (/transactions/<id>, …) still get linked from
 * notifications and bookmarks. Look the record up and send the user to it
 * under its app. `fallback` renders when the record has no single app.
 */
export function RecordRedirect({ load, segment, recordId, fallback }: {
  load: () => Promise<{ appId: string | null }>;
  segment: string;
  recordId: string | null;
  fallback?: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = React.useState<'loading' | 'no-app' | 'error'>('loading');
  const [message, setMessage] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    if (!recordId) return;
    load()
      .then((r) => {
        if (cancelled) return;
        if (r.appId) router.replace(appPath(r.appId, segment, recordId));
        else setState('no-app');
      })
      .catch((err) => {
        if (cancelled) return;
        setState('error');
        setMessage(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [recordId, segment]);

  if (state === 'error') return <Notice text={message} error />;
  if (state === 'no-app') return <>{fallback ?? <Notice text="This record isn't tied to a single app." />}</>;
  return <Notice text="Opening…" />;
}
