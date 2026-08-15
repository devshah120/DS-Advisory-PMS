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
};
