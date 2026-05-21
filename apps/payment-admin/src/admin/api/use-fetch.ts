'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './client';

export interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | Error | null;
  refetch: () => void;
}

/** Fire-on-mount data hook. `deps` triggers a refetch when changed. */
export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [tick, setTick] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableFetcher = useCallback(fetcher, deps);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    stableFetcher()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [stableFetcher, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, refetch };
}
