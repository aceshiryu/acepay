'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '../../admin/api/client';
import { AceLogo, Button, Icon } from '../../admin/primitives';
import { Field, inputStyle } from '../../admin/shared';
import { useAuth } from '../../admin/auth/auth-context';

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace('/');
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message
          : err instanceof Error ? err.message
            : 'Login failed';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 380,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-2)',
        padding: 32,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <AceLogo size={28} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 17, letterSpacing: -0.2 }}>AcePay</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Admin sign-in</div>
          </div>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              required
              placeholder="you@example.com"
              style={inputStyle}
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              placeholder="••••••••"
              style={inputStyle}
            />
          </Field>

          {error && (
            <div style={{
              padding: '8px 11px',
              background: 'var(--bad-soft)', color: 'var(--bad)',
              borderRadius: 6, fontSize: 12, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Icon name="warn" size={13} color="var(--bad)" />
              {error}
            </div>
          )}

          <Button
            variant="primary"
            size="lg"
            style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
