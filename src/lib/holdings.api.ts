import { apiClient } from './api';
import type { Holding, HoldingsAsOf } from '@/types';

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
  /** 'skipped' is a contract-note trade already on the ledger. */
  status: 'imported' | 'failed' | 'skipped';
  error?: string;
}

export interface BulkImportSummary {
  total: number;
  imported: number;
  failed: number;
  skipped?: number;
  results: BulkImportRowResult[];
}

/** One trade as read off a contract note, before the user reviews it. */
export interface ContractNoteTrade {
  line: number;
  /** YYYY-MM-DD */
  tradeDate: string;
  tradeTime: string | null;
  securityName: string;
  isin: string;
  exchange: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  rate: number;
  /** Quantity × rate — excludes charges. */
  total: number;
  charges: number;
  reference: string;
  warnings: string[];
  /** Resolved from the ISIN; null when neither NSE nor Yahoo knows it. */
  symbol: string | null;
}

export interface ContractNotePreview {
  broker: string;
  clientCode: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  trades: ContractNoteTrade[];
  /** Rows that looked like trades but could not be read. */
  errors: string[];
  suggestedClientId: string | null;
}

export interface ContractNoteCommit {
  clientId: string;
  includeCharges: boolean;
  trades: {
    line: number;
    date: string;
    side: 'BUY' | 'SELL';
    symbol: string;
    quantity: number;
    total: number;
    charges: number;
    reference: string;
    isin?: string;
  }[];
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

  /** Reads a broker contract note PDF. Writes nothing. */
  async previewContractNote(file: File, password?: string): Promise<ContractNotePreview> {
    const form = new FormData();
    form.append('file', file);
    if (password) form.append('password', password);

    const res = await apiClient.getClient().post<ContractNotePreview>(
      '/holdings/import/contract-note/preview',
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return res.data;
  },

  /** Books the reviewed trades; ones already on the ledger come back 'skipped'. */
  async commitContractNote(input: ContractNoteCommit): Promise<BulkImportSummary> {
    const res = await apiClient
      .getClient()
      .post<BulkImportSummary>('/holdings/import/contract-note', input);
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
   * The client's holdings statement as it stood at the close of `date`
   * (YYYY-MM-DD, exactly as the date input produced it — never round-tripped
   * through a Date, which shifts the day in any zone west of UTC).
   */
  async getPortfolioAsOfDate(clientId: string, date: string): Promise<HoldingsAsOf> {
    const res = await apiClient
      .getClient()
      .get<HoldingsAsOf>(`/holdings/client/${clientId}/as-of-date/${date}`);
    return res.data;
  },
};
