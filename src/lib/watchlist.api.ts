import { apiClient } from './api';
import { Watchlist, WatchlistReturns, BenchmarkReturns, WatchlistFolder, WatchlistSlot, BulkAddResult } from '@/types';
import type { Market } from './market-scope';

/**
 * Every call carries the selected book.
 *
 * On a read it scopes the list; on a write it is what qualifies a bare ticker
 * against the right exchange — "RELIANCE" only resolves once the server turns
 * it into "RELIANCE.NS", which is why adding an Indian name without this fails.
 */
export const watchlistApi = {
  async list(slot?: WatchlistSlot, market?: Market): Promise<Watchlist[]> {
    const res = await apiClient
      .getClient()
      .get<Watchlist[]>('/watchlist', { params: { ...(slot ? { slot } : {}), ...(market ? { market } : {}) } });
    return res.data;
  },

  async add(ticker: string, slot: WatchlistSlot, market?: Market): Promise<Watchlist> {
    const res = await apiClient.getClient().post<Watchlist>('/watchlist', { ticker, slot, market });
    return res.data;
  },

  async bulkAdd(tickers: string[], slot: WatchlistSlot, market?: Market): Promise<BulkAddResult> {
    const res = await apiClient.getClient().post<BulkAddResult>('/watchlist/bulk', { tickers, slot, market });
    return res.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.getClient().delete(`/watchlist/${id}`);
  },

  async returnsFor(id: string): Promise<WatchlistReturns> {
    const res = await apiClient.getClient().get<WatchlistReturns>(`/watchlist/${id}/returns`);
    return res.data;
  },

  /** The selected book's indices — Nifty/Sensex for India, S&P/Russell/Dow for the US. */
  async benchmarks(market?: Market): Promise<BenchmarkReturns[]> {
    const res = await apiClient
      .getClient()
      .get<BenchmarkReturns[]>('/watchlist/benchmarks', { params: market ? { market } : undefined });
    return res.data;
  },

  async folders(market?: Market): Promise<WatchlistFolder[]> {
    const res = await apiClient
      .getClient()
      .get<WatchlistFolder[]>('/watchlist/folders', { params: market ? { market } : undefined });
    return res.data;
  },

  async renameFolder(slot: WatchlistSlot, name: string, market?: Market): Promise<WatchlistFolder> {
    const res = await apiClient
      .getClient()
      .post<WatchlistFolder>(`/watchlist/folders/${slot}`, { name, market });
    return res.data;
  },
};
