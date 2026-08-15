'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_MARKET,
  MARKET_META,
  MARKET_STORAGE_KEY,
  type Market,
  type MarketMeta,
  parseMarket,
} from '@/lib/market-scope';

interface MarketContextValue {
  market: Market;
  meta: MarketMeta;
  setMarket: (market: Market) => void;
  /**
   * False until the persisted choice has been read from localStorage.
   *
   * Pages gate their fetches on this so they issue ONE request for the correct
   * book, rather than firing for the US default on mount and then immediately
   * refetching for India — which would flash the wrong book's AUM on screen for
   * anyone whose saved selection is India.
   */
  ready: boolean;
}

const MarketContext = createContext<MarketContextValue | null>(null);

/**
 * Holds which book of business (US or India) the app is currently showing.
 *
 * The selection lives above the router so it survives navigation — switching to
 * India on the dashboard and then opening Holdings keeps you in the Indian book.
 * It is persisted to localStorage rather than the URL because it is a workspace
 * preference, not a property of any one page, and a PM who manages the Indian
 * book should land in it on every sign-in.
 *
 * Deliberately NOT initialised from localStorage in useState: that runs during
 * SSR/hydration where `window` doesn't exist, and reading it in the initialiser
 * would make the server and client render disagree. The effect below applies the
 * stored value on mount instead, with `ready` telling consumers when to fetch.
 */
export function MarketProvider({ children }: { children: ReactNode }) {
  const [market, setMarketState] = useState<Market>(DEFAULT_MARKET);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MARKET_STORAGE_KEY);
      if (saved) setMarketState(parseMarket(saved));
    } catch {
      // A blocked/full localStorage just means the default book — not an error
      // worth surfacing, since the selector still works for this session.
    }
    setReady(true);
  }, []);

  const setMarket = useCallback((next: Market) => {
    setMarketState(next);
    try {
      window.localStorage.setItem(MARKET_STORAGE_KEY, next);
    } catch {
      // Selection still applies in-memory for this session.
    }
  }, []);

  const value = useMemo<MarketContextValue>(
    () => ({ market, meta: MARKET_META[market], setMarket, ready }),
    [market, setMarket, ready],
  );

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket(): MarketContextValue {
  const ctx = useContext(MarketContext);
  if (!ctx) {
    throw new Error('useMarket must be used inside a MarketProvider');
  }
  return ctx;
}

/**
 * Just the selected book's currency code — 'USD' or 'INR'.
 *
 * A convenience for the many small presentational components that render money
 * and need nothing else from the context. Threading a `currency` prop down
 * through every one of them would be a wide, purely mechanical change to code
 * that is otherwise unrelated to markets; reading it here keeps each component's
 * signature as it was.
 *
 * Falls back to USD outside a provider rather than throwing, so a component can
 * still be rendered in isolation (a test, a storybook) without being wrapped.
 */
export function useCurrency(): string {
  return useContext(MarketContext)?.meta.currency ?? 'USD';
}
