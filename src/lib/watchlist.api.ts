import { apiClient } from './api';
import { Watchlist, WatchlistReturns, BenchmarkReturns, WatchlistFolder, WatchlistSlot, BulkAddResult } from '@/types';

export const watchlistApi = {
  async list(slot?: WatchlistSlot): Promise<Watchlist[]> {
    const res = await apiClient.getClient().get<Watchlist[]>('/watchlist', { params: slot ? { slot } : undefined });
    return res.data;
  },

  async add(ticker: string, slot: WatchlistSlot): Promise<Watchlist> {
    const res = await apiClient.getClient().post<Watchlist>('/watchlist', { ticker, slot });
    return res.data;
  },

  async bulkAdd(tickers: string[], slot: WatchlistSlot): Promise<BulkAddResult> {
    const res = await apiClient.getClient().post<BulkAddResult>('/watchlist/bulk', { tickers, slot });
    return res.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.getClient().delete(`/watchlist/${id}`);
  },

  async returnsFor(id: string): Promise<WatchlistReturns> {
    const res = await apiClient.getClient().get<WatchlistReturns>(`/watchlist/${id}/returns`);
    return res.data;
  },

  async benchmarks(): Promise<BenchmarkReturns[]> {
    const res = await apiClient.getClient().get<BenchmarkReturns[]>('/watchlist/benchmarks');
    return res.data;
  },

  async folders(): Promise<WatchlistFolder[]> {
    const res = await apiClient.getClient().get<WatchlistFolder[]>('/watchlist/folders');
    return res.data;
  },

  async renameFolder(slot: WatchlistSlot, name: string): Promise<WatchlistFolder> {
    const res = await apiClient.getClient().post<WatchlistFolder>(`/watchlist/folders/${slot}`, { name });
    return res.data;
  },
};
