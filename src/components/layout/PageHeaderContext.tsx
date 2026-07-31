'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface PageHeading {
  title?: string;
  subtitle?: string;
  /** Live JSX bound to the page's own state -- buttons, modal triggers, etc. */
  actions?: ReactNode;
}

interface PageHeaderStore extends PageHeading {
  set: (heading: PageHeading) => void;
  clear: () => void;
  /**
   * Live handle on the current heading. The layout reads `actions` through this
   * at render time so the buttons always carry the page's latest closures, even
   * though publishing them doesn't itself trigger a re-render.
   */
  ref: { current: PageHeading };
}

const PageHeaderContext = createContext<PageHeaderStore | null>(null);

/**
 * Text-only identity of a heading, used to short-circuit redundant re-renders.
 *
 * Deliberately excludes `actions`: it is a fresh React element on every render
 * of the owning page, so it can never be compared by reference, and comparing
 * by content isn't practical either. That is why the layout reads `actions`
 * live through the ref instead -- it never needs to be diffed, only its
 * presence does (see `set` below).
 */
const headingTextKey = (h: PageHeading) => `${h.title ?? ''} ${h.subtitle ?? ''}`;

export function PageHeaderProvider({ children }: { children: ReactNode }) {
  // The live heading. Held in a ref so a page publishing on every render never
  // by itself schedules a re-render of the whole shell.
  const current = useRef<PageHeading>({});
  // Bumped whenever the rendered result might differ, which is what actually
  // needs to reach the layout.
  const [version, setVersion] = useState(0);

  const set = useCallback((next: PageHeading) => {
    const prev = current.current;
    // The ref always holds the latest heading, so the layout reading through
    // `ref.current` at render time picks up fresh action closures for free.
    // Only the *rendered form* changing needs to force a re-render, and that is
    // exactly the text plus whether actions appeared or disappeared.
    //
    // Treating "has actions" as always-changed (the previous rule) never
    // converges: the effect that calls this runs after every render, so
    // bumping the version on every call re-renders the page, which calls this
    // again -- an infinite loop that hangs the tab on any page heavy enough
    // that one render costs real time.
    const changed =
      headingTextKey(prev) !== headingTextKey(next) || !!prev.actions !== !!next.actions;
    current.current = next;
    if (changed) setVersion((v) => v + 1);
  }, []);

  const clear = useCallback(() => {
    const prev = current.current;
    if (headingTextKey(prev) === headingTextKey({}) && !prev.actions) return;
    current.current = {};
    setVersion((v) => v + 1);
  }, []);

  const value = useMemo<PageHeaderStore>(
    () => ({ ...current.current, set, clear, ref: current }),
    // `version` is the trigger: it changes precisely when the heading's
    // rendered form changes, so the memo re-reads the ref at the right moments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, set, clear]
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
 * navigating no longer unmounts the shell -- but pages still own their actions,
 * which are bound to their own state and handlers.
 *
 * Deliberately takes no dependency array. The obvious design -- letting callers
 * list what their `actions` JSX closes over -- is a trap: pages routinely pass
 * plain functions and objects that are new identities on every render, and a
 * single unstable entry becomes an infinite update loop that also blocks
 * navigation. Change detection lives in the provider instead.
 */
export function usePageHeading(heading: PageHeading) {
  const { set, clear } = usePageHeader();

  // No dependency array: publishing after every render keeps the actions JSX
  // closed over current state. Safe because `set` only triggers a re-render
  // when the heading's rendered form actually changes.
  useEffect(() => {
    set(heading);
  });

  // Clear on unmount only, so one page's buttons never linger above the next.
  const clearRef = useRef(clear);
  clearRef.current = clear;
  useEffect(() => () => clearRef.current(), []);
}
