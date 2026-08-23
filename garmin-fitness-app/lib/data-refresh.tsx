'use client';
import { createContext, useContext, useCallback } from 'react';

/**
 * One shared refresh channel for the whole app.
 *
 * `refreshData()` re-runs the top-level fetches in app/page.tsx (activities,
 * wellness, FTP) and bumps `dataVersion`. Components that fetch their own data
 * (exercise logs, HR/power zones, insights, weekly report) put `dataVersion` in
 * their useEffect dependency array, so any successful write anywhere in the app
 * makes every view re-fetch — no browser refresh required.
 */
export interface DataRefreshValue {
  dataVersion: number;
  refreshData: () => Promise<void>;
}

const DataRefreshContext = createContext<DataRefreshValue>({
  dataVersion: 0,
  refreshData: async () => {},
});

export const DataRefreshProvider = DataRefreshContext.Provider;

export function useDataRefresh(): DataRefreshValue {
  return useContext(DataRefreshContext);
}

/** Convenience for effect dependency arrays. */
export function useDataVersion(): number {
  return useContext(DataRefreshContext).dataVersion;
}

/**
 * Wraps a mutation helper so a SUCCESSFUL write (and only a successful one)
 * triggers a global refresh. The returned function is stable as long as
 * `refreshData` is, so it is safe in dependency arrays.
 */
export function useRefreshAfter<A extends unknown[]>(
  fn: (...args: A) => Promise<boolean>
): (...args: A) => Promise<boolean> {
  const { refreshData } = useDataRefresh();
  return useCallback(
    async (...args: A) => {
      const ok = await fn(...args);
      if (ok) await refreshData();
      return ok;
    },
    [fn, refreshData]
  );
}
