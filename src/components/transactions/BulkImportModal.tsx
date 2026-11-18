'use client';

import { useRef, useState } from 'react';
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  MinusCircle,
} from 'lucide-react';
import { holdingsApi, type BulkImportSummary } from '@/lib/holdings.api';
import { cn } from '@/lib/utils';
import { Modal, Button, useToast } from '@/components/ui';

/**
 * Books a spreadsheet of trades onto the ledger.
 *
 * Lives on the Transactions screen because what it writes is transactions:
 * each row records a dated buy/sell, and the holding it touches is updated
 * through the same path as a single Add Position. `onImported` fires after any
 * run that booked at least one row, so the caller can reload its ledger.
 */
export function BulkImportModal({
  isOpen,
  onClose,
  onImported,
}: {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<BulkImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function close() {
    if (importing) return;
    // Reset on close rather than open, so a reopened dialog never shows the
    // previous run's file or result.
    setFile(null);
    setResult(null);
    onClose();
  }

  async function handleDownloadTemplate() {
    try {
      await holdingsApi.downloadTemplate();
      toast({ tone: 'success', title: 'Sample downloaded', description: 'transactions-import-sample.xlsx' });
    } catch {
      toast({ tone: 'error', title: 'Could not download the sample file' });
    }
  }

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      const summary = await holdingsApi.bulkImport(file);

      if ((summary as BulkImportSummary & { mock?: boolean }).mock) {
        toast({
          tone: 'warning',
          title: 'Mock mode',
          description: 'Bulk import needs the live API. Set NEXT_PUBLIC_USE_MOCK=false.',
        });
        setResult(summary);
        return;
      }

      setResult(summary);
      // The file has been booked; leaving it selected kept Import live, and a
      // second click booked every trade again.
      setFile(null);
      if (summary.imported > 0) await onImported();

      const skipped = summary.skipped ?? 0;
      if (summary.failed === 0) {
        toast({
          tone: 'success',
          title: 'Import complete',
          description:
            `${summary.imported} trade${summary.imported === 1 ? '' : 's'} imported` +
            (skipped ? ` · ${skipped} already on the ledger` : ''),
        });
      } else {
        toast({
          tone: summary.imported > 0 ? 'warning' : 'error',
          title: 'Import finished with issues',
          description: `${summary.imported} imported · ${summary.failed} failed`,
        });
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.message ??
        (typeof err?.message === 'string' ? err.message : 'Import failed');
      toast({ tone: 'error', title: 'Import failed', description: String(message) });
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Bulk Import Transactions"
      description="Upload an .xlsx or .csv of trades. Each row records a dated buy/sell transaction and updates the holding through the same path as a single Add Position — repeated symbols fold into the existing lot at weighted-average cost."
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" leftIcon={<Download className="h-4 w-4" />} onClick={handleDownloadTemplate}>
            Download sample .xlsx
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={close} disabled={importing}>
              {result ? 'Close' : 'Cancel'}
            </Button>
            <Button
              leftIcon={<Upload className="h-4 w-4" />}
              onClick={handleImport}
              disabled={!file || importing}
              loading={importing}
            >
              {importing ? 'Importing…' : 'Import'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* File picker */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full items-center gap-3 rounded-[12px] border border-dashed border-border bg-surface-2 px-4 py-5 text-left transition-colors hover:border-brand hover:bg-surface-3"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-surface-3 text-ink-secondary">
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-ink">{file ? file.name : 'Choose a file to import'}</p>
            <p className="text-xs text-ink-tertiary">
              {file ? `${(file.size / 1024).toFixed(1)} KB · click to replace` : 'Accepts .xlsx, .xls or .csv'}
            </p>
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            // Allow re-selecting the same file after a failed run.
            e.target.value = '';
          }}
        />

        <p className="text-xs text-ink-tertiary">
          Columns: <span className="font-medium text-ink-secondary">Action, Date, Client Name, Symbol, Quantity, Amount Invested</span>.
          Company, sector, industry, country, exchange, theme, average cost and the live price are all filled in
          automatically from the symbol — the same details the Add Position screen resolves for you.
        </p>

        {/* Result summary */}
        {result && !(result as any).mock && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ResultTile label="Total rows" value={result.total} />
              <ResultTile label="Imported" value={result.imported} tone="success" />
              <ResultTile label="Already on ledger" value={result.skipped ?? 0} />
              <ResultTile label="Failed" value={result.failed} tone={result.failed ? 'danger' : undefined} />
            </div>

            {result.results.length > 0 && (
              <div className="max-h-56 overflow-auto rounded-[12px] border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-2 text-xs text-ink-tertiary">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Row</th>
                      <th className="px-3 py-2 text-left font-medium">Ticker</th>
                      <th className="px-3 py-2 text-left font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((r) => (
                      <tr key={r.row} className="border-t border-border">
                        <td className="px-3 py-2 tabular-nums text-ink-secondary">{r.row}</td>
                        <td className="px-3 py-2 font-medium text-ink">{r.ticker ?? '—'}</td>
                        <td className="px-3 py-2">
                          {r.status === 'imported' ? (
                            <span className="inline-flex items-center gap-1 text-success">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Imported
                            </span>
                          ) : r.status === 'skipped' ? (
                            <span className="inline-flex items-center gap-1 text-ink-secondary">
                              <MinusCircle className="h-3.5 w-3.5" /> {r.error ?? 'Skipped'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-danger">
                              <XCircle className="h-3.5 w-3.5" /> {r.error ?? 'Failed'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResultTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="rounded-[12px] border border-border bg-surface-2 px-3 py-2.5">
      <p className="text-xs text-ink-secondary">{label}</p>
      <p
        className={cn(
          'value-display text-xl font-semibold',
          tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-ink'
        )}
      >
        {value}
      </p>
    </div>
  );
}
