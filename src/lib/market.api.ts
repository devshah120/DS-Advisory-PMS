import { apiClient } from './api';
import type { Market } from './market-scope';

export interface SymbolLookup {
  /** The resolved, fully-qualified Yahoo symbol — 'RELIANCE' comes back as 'RELIANCE.NS'. */
  ticker: string;
  /** The same symbol without its exchange suffix, for display. */
  displayTicker: string;
  company: string;
  sector: string;
  industry: string;
  country: string;
  theme: string;
  exchange: string;
  currentPrice?: number;
  currency?: string;
  /** Which book the resolved symbol trades in. */
  market: Market;
  source: 'yahoo' | 'fallback';
}

/** One symbol's market capitalisation, as /market/market-caps reports it. */
export interface MarketCapQuote {
  /** In INR, converted from the listing currency where needed; null for ETFs, funds and unknowns. */
  marketCapInr: number | null;
  /** The currency the cap was reported in before conversion; null with no cap. */
  currency: string | null;
  /** Yahoo's quoteType for the held symbol ('EQUITY', 'ETF', …). */
  quoteType: string | null;
}

export class SymbolNotFoundError extends Error {
  constructor(ticker: string) {
    super(`No symbol found for "${ticker}"`);
    this.name = 'SymbolNotFoundError';
  }
}

export const marketApi = {
  /**
   * `market` tells the server how to read a BARE ticker: under the Indian book
   * "RELIANCE" is resolved as "RELIANCE.NS" (and retried on the BSE), which is
   * what lets a user type the plain name they know. A symbol typed with its own
   * suffix is always honoured as-is, in either book.
   */
  async lookup(ticker: string, market?: Market, signal?: AbortSignal): Promise<SymbolLookup> {
    try {
      const res = await apiClient
        .getClient()
        .get<SymbolLookup>(`/market/lookup/${encodeURIComponent(ticker)}`, {
          params: market ? { market } : undefined,
          signal,
        });
      return res.data;
    } catch (err: any) {
      if (err?.response?.status === 404) throw new SymbolNotFoundError(ticker);
      throw err;
    }
  },

  /**
   * Market caps for fully-qualified Yahoo symbols, keyed by the upper-cased
   * symbol. Every requested symbol has an entry; throws when the server
   * couldn't reach the data source at all.
   */
  async marketCaps(symbols: string[]): Promise<Record<string, MarketCapQuote>> {
    if (symbols.length === 0) return {};
    const res = await apiClient
      .getClient()
      .get<Record<string, MarketCapQuote>>('/market/market-caps', {
        params: { symbols: symbols.join(',') },
      });
    return res.data;
  },
};
