'use client';

import {
  createContext,
  isValidElement,
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

/**
 * Identity of the *props* the action elements were built from.
 *
 * The ref gives the layout fresh closures for free, but only if the layout
 * re-renders at all. For a stateless button that never matters -- clicking it
 * fires the handler and the page re-renders itself. For a *controlled* input in
 * the header (the client `<Select>` on Performance) it matters completely: its
 * displayed value comes from page state, so if the shell never re-renders it
 * keeps painting the element built from the previous value and the dropdown
 * appears frozen on the old selection while the page below it updates.
 *
 * Diffing the whole element is impractical, but the part that decides what the
 * user sees -- the props of the top-level action elements -- is shallow,
 * primitive-valued, and cheap to key. Function props are skipped: they are new
 * identities on every render, and including them would bump the version on
 * every publish, which is exactly the infinite loop described in `set`.
 */
const actionsStateKey = (actions: ReactNode): string => {
  const parts: string[] = [];

  const walk = (node: ReactNode, depth: number) => {
    // Depth-capped: this runs after every render of every page, and the header
    // holds a handful of controls, not a tree.
    if (depth > 4 || node == null || typeof node === 'boolean') return;

    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node));
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((child) => walk(child, depth + 1));
      return;
    }

    if (!isValidElement(node)) return;

    const props = node.props as Record<string, unknown>;
    for (const key of Object.keys(props).sort()) {
      if (key === 'children') continue;
      const v = props[key];
      // Only primitives: functions are unstable by nature, objects and elements
      // are handled by recursing into children below.
      if (
        typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean' ||
        v === null
      ) {
        parts.push(`${key}=${String(v)}`);
      }
    }

    walk(props.children as ReactNode, depth + 1);
  };

  walk(actions, 0);
  return parts.join('|');
};

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
    //
    // `actionsStateKey` is the third term because presence alone is too coarse
    // for controlled inputs: a `<Select>` whose `value` moved from one client to
    // the next is still "has actions", so the shell never re-rendered and the
    // dropdown stayed stuck on the old name. The key is built from primitive
    // props only, so it converges -- equal renders produce equal keys.
    const changed =
      headingTextKey(prev) !== headingTextKey(next) ||
      !!prev.actions !== !!next.actions ||
      actionsStateKey(prev.actions) !== actionsStateKey(next.actions);
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
