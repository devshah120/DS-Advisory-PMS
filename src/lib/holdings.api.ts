import { apiClient } from './api';

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
    a.download = 'holdings-import-template.xlsx';
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
};
