import { apiClient } from './api';
import type { Market } from './market-scope';

/**
 * Manual sector classification, held PER SYMBOL.
 *
 * The unit of the decision is the symbol, not the holding row: SAHAJSOLAR.NS
 * sits in three accounts, and classifying it once must fix all three — plus any
 * account that buys it later. The write lands on the instrument profile, which
 * every allocation reader already prefers over the stored holding row.
 */

/** One symbol awaiting a sector decision, with the exposure that makes it matter. */
export interface UnclassifiedSymbol {
  symbol: string;
  company: string;
  market: Market;
  /** Summed across every account in scope. */
  quantity: number;
  marketValue: number;
  /** Share of the whole in-scope book — so the list can be worked largest-first. */
  weight: number;
  holders: Array<{
    clientId: string;
    clientName: string;
    quantity: number;
    marketValue: number;
  }>;
}

export interface ClassificationQueue {
  /** The closed vocabulary the dropdown offers, ending in 'Miscellaneous'. */
  sectors: string[];
  symbols: UnclassifiedSymbol[];
  totals: {
    symbolCount: number;
    marketValue: number;
    /** How much of the book is currently unlabelled. */
    weight: number;
  };
}

export const classificationApi = {
  async unclassified(market?: Market): Promise<ClassificationQueue> {
    const res = await apiClient
      .getClient()
      .get<ClassificationQueue>('/holdings/classification/unclassified', {
        params: market ? { market } : undefined,
      });
    return res.data;
  },

  /**
   * Classify one symbol for good. Returns how many holding rows were refreshed,
   * which is what lets the caller say "applied to 3 accounts" rather than
   * leaving the reader to guess the edit's reach.
   */
  async setSector(
    symbol: string,
    sector: string,
  ): Promise<{ symbol: string; sector: string; holdingsUpdated: number }> {
    const res = await apiClient
      .getClient()
      .patch(`/holdings/classification/${encodeURIComponent(symbol)}/sector`, { sector });
    return res.data;
  },
};
