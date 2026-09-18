import { apiClient } from './api';
import { Holding } from '@/types';

/**
 * A correction to one dated fill behind a position.
 *
 * `amount` is what the fill actually cost or realised; the per-share price is
 * derived from it server-side, so the two can never disagree on the blotter.
 * Every field is optional — only what the user changed needs to travel.
 */
export interface LotInput {
  date?: string;
  side?: 'BUY' | 'SELL';
  quantity?: number;
  amount?: number;
}

export interface BulkImportRowResult {
  row: number;
  ticker: string | null;
  status: 'imported' | 'failed';
  error?: string;
}

export interface BulkImportSummary {
  total: number;
  imported: number;
  failed: number;
  results: BulkImportRowResult[];
}

export const holdingsApi = {
  /**
   * Downloads the sample import workbook and triggers a browser save. The
   * backend generates it from the same column list its parser reads, so the
   * file a user gets back always round-trips.
   */
  async downloadTemplate() {
    const res = await apiClient
      .getClient()
      .get('/holdings/import/template', { responseType: 'blob' });

    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transactions-import-sample.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /** Uploads an .xlsx/.csv of positions and returns the per-row outcome. */
  async bulkImport(file: File): Promise<BulkImportSummary> {
    const form = new FormData();
    form.append('file', file);

    const res = await apiClient.getClient().post<BulkImportSummary>(
      '/holdings/import',
      form,
      // Let the browser set the multipart boundary; overriding the default
      // JSON Content-Type from the axios instance.
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data;
  },

  /**
   * Correct one dated fill behind a position, and get the rebuilt position back.
   *
   * The write lands on the transaction, not the holding: quantity and average
   * cost here are a summary of the ledger, and the backend recomputes them from
   * it once the correction is in. That is why this returns the whole holding —
   * the caller splices the server's numbers into its table rather than guessing
   * what the correction did to the weighted average.
   */
  async updateLot(holdingId: string, lotId: string, input: LotInput): Promise<Holding> {
    const res = await apiClient
      .getClient()
      .patch<Holding>(`/holdings/${holdingId}/lots/${lotId}`, input);
    return res.data;
  },

  /** Book a fill that was never recorded. Returns the rebuilt position. */
  async addLot(holdingId: string, input: LotInput): Promise<Holding> {
    const res = await apiClient
      .getClient()
      .post<Holding>(`/holdings/${holdingId}/lots`, input);
    return res.data;
  },

  /**
   * Remove a fill that should not be on the ledger. Returns the rebuilt
   * position, which can come back at zero quantity if it was the last lot —
   * a closed position, not a deleted one.
   */
  async removeLot(holdingId: string, lotId: string): Promise<Holding> {
    const res = await apiClient
      .getClient()
      .delete<Holding>(`/holdings/${holdingId}/lots/${lotId}`);
    return res.data;
  },

  /**
   * Deletes a position outright. This removes the holding row only — any
   * transactions already recorded against the ticker stay on the ledger, since
   * they are the record of what actually happened.
   */
  async remove(id: string): Promise<void> {
    await apiClient.getClient().delete(`/holdings/${id}`);
  },

  /**
   * Fetches the portfolio as it existed on a specific date by replaying
   * all buy/sell transactions up to that date.
   */
  async getPortfolioAsOfDate(clientId: string, asOfDate: Date) {
    const dateStr = asOfDate.toISOString().split('T')[0];
    const res = await apiClient
      .getClient()
      .get(`/holdings/client/${clientId}/as-of-date/${dateStr}`);
    return res.data;
  },
};
