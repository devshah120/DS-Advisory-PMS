'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export interface PageHeading {
  title?: string;
  subtitle?: string;
  /** Live JSX bound to the page's own state — buttons, modals triggers, etc. */
  actions?: ReactNode;
}

interface PageHeaderStore extends PageHeading {
  set: (heading: PageHeading) => void;
  clear: () => void;
}

const PageHeaderContext = createContext<PageHeaderStore | null>(null);

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  const [heading, setHeading] = useState<PageHeading>({});

  const value = useMemo<PageHeaderStore>(
    () => ({
      ...heading,
      set: setHeading,
      clear: () => setHeading({}),
    }),
    [heading]
  );

  return (
    <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>
  );
}

/** Read the current heading. Used by the layout that renders it. */
export function usePageHeader() {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) {
    throw new Error('usePageHeader must be used inside PageHeaderProvider');
  }
  return ctx;
}

/**
 * Declares the title, subtitle and action buttons for the current page.
 *
 * The heading lives in the persistent layout rather than in each page, so
 * navigating no longer unmounts the shell — but pages still own their actions,
 * which are bound to their own state and handlers.
 *
 * `deps` works like any effect dependency array: list whatever the `actions`
 * JSX closes over, so the buttons re-render when that state changes. Without
 * it, an action would capture stale values from the first render.
 */
export function usePageHeading(heading: PageHeading, deps: unknown[] = []) {
  const { set, clear } = usePageHeader();

  useEffect(() => {
    set(heading);
    // Clearing on unmount stops one page's buttons from briefly appearing
    // above the next page during a route transition.
    return clear;
    // `heading` is a fresh object literal every render, so it can't be a
    // dependency itself — the caller's `deps` stand in for its contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
