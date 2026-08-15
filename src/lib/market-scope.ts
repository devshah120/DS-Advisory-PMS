/**
 * Market scope — the frontend half of the API's common/market-scope.ts.
 *
 * The two files are deliberately kept in sync by hand rather than shared through
 * a package: this one carries only what the UI needs to render (label, flag,
 * currency, locale), and the server stays authoritative for which symbols and
 * indices belong to a book.
 */

export type Market = 'US' | 'INDIA';

export const DEFAULT_MARKET: Market = 'US';

/** Where the selected book is persisted, so a reload doesn't snap back to the US. */
export const MARKET_STORAGE_KEY = 'atlas:market';

export interface MarketMeta {
  code: Market;
  label: string;
  /** Short form for the header button, where horizontal space is tight. */
  shortLabel: string;
  flag: string;
  currency: string;
  /**
   * Intl locale used for BOTH currency and plain number formatting.
   *
   * 'en-IN' is what produces the Indian digit grouping (1,25,00,000 rather than
   * 12,500,000) — the lakh/crore convention every Indian client statement uses.
   * Getting this wrong doesn't just look foreign, it makes figures genuinely
   * hard to read at a glance for the audience they are for.
   */
  locale: string;
}

export const MARKET_META: Record<Market, MarketMeta> = {
  US: {
    code: 'US',
    label: 'United States',
    shortLabel: 'US',
    flag: '🇺🇸',
    currency: 'USD',
    locale: 'en-US',
  },
  INDIA: {
    code: 'INDIA',
    label: 'India',
    shortLabel: 'India',
    flag: '🇮🇳',
    currency: 'INR',
    locale: 'en-IN',
  },
};

export const ALL_MARKETS: Market[] = ['US', 'INDIA'];

export function parseMarket(value: unknown): Market {
  if (typeof value !== 'string') return DEFAULT_MARKET;
  const upper = value.trim().toUpperCase();
  return (ALL_MARKETS as string[]).includes(upper) ? (upper as Market) : DEFAULT_MARKET;
}

/** Strips the exchange suffix for display — 'RELIANCE.NS' reads as 'RELIANCE'. */
export function displayTicker(symbol: string): string {
  const s = (symbol ?? '').trim().toUpperCase();
  for (const suffix of ['.NS', '.BO']) {
    if (s.endsWith(suffix)) return s.slice(0, -suffix.length);
  }
  return s;
}
