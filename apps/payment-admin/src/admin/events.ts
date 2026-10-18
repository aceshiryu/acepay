'use client';

import { useEffect } from 'react';

/**
 * Tiny cross-component signal. The sidebar lists apps and their status, so it
 * refetches whenever a page adds, edits, activates or deletes an app.
 */
const APPS_CHANGED = 'acepay:apps-changed';
const PROVIDERS_CHANGED = 'acepay:providers-changed';

export function notifyAppsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(APPS_CHANGED));
}

export function notifyProvidersChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PROVIDERS_CHANGED));
}

function useWindowEvent(name: string, cb: () => void): void {
  useEffect(() => {
    window.addEventListener(name, cb);
    return () => window.removeEventListener(name, cb);
  }, [name, cb]);
}

export const useAppsChanged = (cb: () => void) => useWindowEvent(APPS_CHANGED, cb);
export const useProvidersChanged = (cb: () => void) => useWindowEvent(PROVIDERS_CHANGED, cb);
