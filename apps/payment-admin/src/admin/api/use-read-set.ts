'use client';

import { useCallback, useEffect, useState } from 'react';

/** A persistent string-set in localStorage. Used to track which notification ids
 *  the operator has marked read. The server doesn't store this (per-device only). */
export function useReadSet(storageKey: string) {
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());

  // Hydrate on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setReadIds(new Set(JSON.parse(raw) as string[]));
    } catch { /* ignore */ }
  }, [storageKey]);

  const persist = useCallback((next: Set<string>) => {
    setReadIds(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
    } catch { /* ignore */ }
  }, [storageKey]);

  const markRead = useCallback((id: string) => {
    persist(new Set([...readIds, id]));
  }, [readIds, persist]);

  const markAllRead = useCallback((ids: string[]) => {
    persist(new Set([...readIds, ...ids]));
  }, [readIds, persist]);

  const isRead = useCallback((id: string) => readIds.has(id), [readIds]);

  return { isRead, markRead, markAllRead, readIds };
}
