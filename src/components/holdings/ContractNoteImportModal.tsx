'use client';

import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, MinusCircle, Upload, XCircle } from 'lucide-react';
import {
  holdingsApi,
  type BulkImportSummary,
  type ContractNotePreview,
} from '@/lib/holdings.api';
import { Client } from '@/types';
import { Modal, Button, Input, Select, Badge, useToast } from '@/components/ui';
import { formatCurrency, cn } from '@/lib/utils';

/** A parsed trade as the review table holds it: selectable, with an editable symbol. */
interface Row {
  line: number;
  selected: boolean;
  symbol: string;
}

const PASSWORD_ERROR = /password/i;

/**
 * Upload a broker contract note, review what was read, and book it.
 *
 * Three steps in one modal: pick the PDF, review the parsed trades (client,
 * symbols, which rows to take), then the per-row outcome. Nothing is written
 * until the review is confirmed — the PDF is read server-side by the preview
 * call, and only the reviewed rows are posted back.
 */
export function ContractNoteImportModal({
  isOpen,
  onClose,
  clients,
  onImported,
}: {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  onImported: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [reading, setReading] = useState(false);
  const [preview, setPreview] = useState<ContractNotePreview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [clientId, setClientId] = useState('');
  const [includeCharges, setIncludeCharges] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<BulkImportSummary | null>(null);

  // A contract note is an Indian broker statement; only that book can take it.
  const indianClients = useMemo(
    () =>
      clients
        .filter((c) => c.market === 'INDIA')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  );

  function reset() {
    setFile(null);
    setPassword('');
    setNeedsPassword(false);
    setPreview(null);
    setRows([]);
    setClientId('');
    setIncludeCharges(false);
    setResult(null);
  }

  function close() {
    if (reading || importing) return;
    reset();
    onClose();
  }

  async function read() {
    if (!file) return;
    setReading(true);
    try {
      const p = await holdingsApi.previewContractNote(file, password || undefined);
      setPreview(p);
      setRows(p.trades.map((t) => ({ line: t.line, selected: true, symbol: t.symbol ?? '' })));
      setClientId(p.suggestedClientId ?? '');
      setNeedsPassword(false);
    } catch (err: any) {
      const message = String(
        err?.response?.data?.message ?? err?.message ?? 'Could not read the contract note',
      );
      if (PASSWORD_ERROR.test(message)) setNeedsPassword(true);
      toast({ tone: 'error', title: 'Could not read the contract note', description: message });
    } finally {
      setReading(false);
    }
  }

  const tradeByLine = useMemo(
    () => new Map((preview?.trades ?? []).map((t) => [t.line, t])),
    [preview],
  );
  const selected = rows.filter((r) => r.selected);
  const missingSymbol = selected.some((r) => !r.symbol.trim());

  const totals = useMemo(() => {
    let buy = 0;
    let sell = 0;
    let charges = 0;
    for (const r of selected) {
      const t = tradeByLine.get(r.line);
      if (!t) continue;
      if (t.side === 'BUY') buy += t.total;
      else sell += t.total;
      charges += t.charges;
    }
    return { buy, sell, charges };
  }, [selected, tradeByLine]);

  async function commit() {
    if (!clientId || selected.length === 0 || missingSymbol) return;
    setImporting(true);
    try {
      const summary = await holdingsApi.commitContractNote({
        clientId,
        includeCharges,
        trades: selected.map((r) => {
          const t = tradeByLine.get(r.line)!;
          return {
            line: t.line,
            date: t.tradeDate,
            side: t.side,
            symbol: r.symbol.trim().toUpperCase(),
            quantity: t.quantity,
            total: t.total,
            charges: t.charges,
            reference: t.reference,
            isin: t.isin,
          };
        }),
      });
      setResult(summary);
      await onImported();

      const skipped = summary.skipped ?? 0;
      if (summary.failed === 0) {
        toast({
          tone: 'success',
          title: 'Contract note imported',
          description:
            `${summary.imported} trade${summary.imported === 1 ? '' : 's'} booked` +
            (skipped ? ` · ${skipped} already on the ledger` : ''),
        });
      } else {
        toast({
          tone: summary.imported > 0 ? 'warning' : 'error',
          title: 'Import finished with issues',
          description: `${summary.imported} booked · ${summary.failed} failed · ${skipped} skipped`,
        });
      }
    } catch (err: any) {
      const message = err?.response?.data?.message ?? err?.message ?? 'Import failed';
      toast({
        tone: 'error',
        title: 'Import failed',
        description: Array.isArray(message) ? message.join(', ') : String(message),
      });
    } finally {
      setImporting(false);
    }
  }

  const currency = 'INR';
  const step: 'pick' | 'review' | 'done' = result ? 'done' : preview ? 'review' : 'pick';

  const footer =
    step === 'pick' ? (
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={close} disabled={reading}>
          Cancel
        </Button>
        <Button
          leftIcon={<FileText className="h-4 w-4" />}
          onClick={read}
          disabled={!file || reading}
          loading={reading}
        >
          {reading ? 'Reading…' : 'Read contract note'}
        </Button>
      </div>
    ) : step === 'review' ? (
      <div className="flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={reset} disabled={importing}>
          Choose another file
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={close} disabled={importing}>
            Cancel
          </Button>
          <Button
            leftIcon={<Upload className="h-4 w-4" />}
            onClick={commit}
            disabled={!clientId || selected.length === 0 || missingSymbol || importing}
            loading={importing}
          >
            {importing
              ? 'Importing…'
              : `Import ${selected.length} trade${selected.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    ) : (
      <div className="flex items-center justify-end">
        <Button onClick={close}>Close</Button>
      </div>
    );

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Upload Contract Note"
      description="Upload the broker's equity statement PDF. Every trade is read, matched to its NSE symbol by ISIN, and shown for review before anything is booked."
      size={step === 'pick' ? 'lg' : '2xl'}
      footer={footer}
    >
      {step === 'pick' && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center gap-3 rounded-[12px] border border-dashed border-border bg-surface-2 px-4 py-5 text-left transition-colors hover:border-brand hover:bg-surface-3"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-surface-3 text-ink-secondary">
              <FileText className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">
                {file ? file.name : 'Choose a contract note PDF'}
              </p>
              <p className="text-xs text-ink-tertiary">
                {file
                  ? `${(file.size / 1024).toFixed(1)} KB · click to replace`
                  : 'Supported: Kotak Neo equity transaction statement (.pdf)'}
              </p>
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setNeedsPassword(false);
              setPassword('');
              e.target.value = '';
            }}
          />
          {needsPassword && (
            <Input
              label="PDF password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              helper="Brokers usually lock contract notes with the client's PAN or date of birth."
            />
          )}
        </div>
      )}

      {step === 'review' && preview && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
            <Badge tone="brand">{preview.broker}</Badge>
            {preview.clientCode && <Badge>Client code {preview.clientCode}</Badge>}
            {preview.periodFrom && (
              <Badge>
                {preview.periodFrom}
                {preview.periodTo && preview.periodTo !== preview.periodFrom ? ` → ${preview.periodTo}` : ''}
              </Badge>
            )}
            <span>{preview.trades.length} trades read</span>
          </div>

          {preview.errors.length > 0 && (
            <div className="rounded-[12px] border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger">
              <p className="font-semibold">
                {preview.errors.length} row{preview.errors.length === 1 ? '' : 's'} could not be read — enter
                {preview.errors.length === 1 ? ' it' : ' them'} manually:
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {preview.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Client"
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              helper={
                preview.suggestedClientId
                  ? 'Matched by the client code in the file name — confirm it is right.'
                  : preview.clientCode
                    ? `No India client has account number ${preview.clientCode}. Choose one.`
                    : 'Choose the client this statement belongs to.'
              }
            >
              <option value="">Select a client…</option>
              {indianClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.broker} · {c.accountNumber}
                </option>
              ))}
            </Select>
            <label className="flex cursor-pointer items-start gap-3 self-start rounded-[10px] border border-border p-3.5 transition-colors hover:bg-surface-2">
              <input
                type="checkbox"
                checked={includeCharges}
                onChange={(e) => setIncludeCharges(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-brand focus:ring-brand/25"
              />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-ink">
                  Add brokerage &amp; taxes to cost
                </span>
                <span className="block text-xs text-ink-tertiary">
                  Off: booked at quantity × rate, the way existing trades were entered.
                </span>
              </span>
            </label>
          </div>

          <div className="max-h-[22rem] overflow-auto rounded-[12px] border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface-2 text-xs text-ink-tertiary">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">
                    <input
                      type="checkbox"
                      aria-label="Select all trades"
                      checked={rows.length > 0 && selected.length === rows.length}
                      onChange={(e) =>
                        setRows((rs) => rs.map((r) => ({ ...r, selected: e.target.checked })))
                      }
                      className="h-4 w-4 rounded border-border text-brand focus:ring-brand/25"
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Security</th>
                  <th className="px-3 py-2 text-left font-medium">Side</th>
                  <th className="px-3 py-2 text-left font-medium">Symbol</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">Charges</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const t = tradeByLine.get(r.line)!;
                  return (
                    <tr key={r.line} className={cn('border-t border-border', !r.selected && 'opacity-50')}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Import ${t.securityName}`}
                          checked={r.selected}
                          onChange={(e) =>
                            setRows((rs) =>
                              rs.map((x) => (x.line === r.line ? { ...x, selected: e.target.checked } : x)),
                            )
                          }
                          className="h-4 w-4 rounded border-border text-brand focus:ring-brand/25"
                        />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink-secondary">
                        {t.tradeDate.split('-').reverse().join('-')}
                        {t.tradeTime && <span className="block text-[11px] text-ink-tertiary">{t.tradeTime}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className="block font-medium text-ink">{t.securityName}</span>
                        <span className="block text-[11px] text-ink-tertiary">
                          {t.isin} · {t.exchange}
                        </span>
                        {t.warnings.map((w) => (
                          <span key={w} className="mt-0.5 flex items-center gap-1 text-[11px] text-warning">
                            <AlertTriangle className="h-3 w-3 shrink-0" /> {w}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={t.side === 'BUY' ? 'success' : 'danger'}>
                          {t.side === 'BUY' ? 'Buy' : 'Sell'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={r.symbol}
                          onChange={(e) =>
                            setRows((rs) =>
                              rs.map((x) => (x.line === r.line ? { ...x, symbol: e.target.value } : x)),
                            )
                          }
                          placeholder="e.g. RELIANCE.NS"
                          aria-label={`Symbol for ${t.securityName}`}
                          className={cn(
                            'w-36 rounded-[8px] border bg-surface px-2 py-1 text-sm font-medium uppercase text-ink outline-none focus:ring-2 focus:ring-brand/25',
                            r.selected && !r.symbol.trim() ? 'border-danger' : 'border-border',
                          )}
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.quantity}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.rate.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(t.total, currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                        {formatCurrency(t.charges, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-secondary">
            <span>
              {missingSymbol
                ? 'Enter a symbol for every highlighted row (NSE did not list its ISIN).'
                : 'Trades already on this client’s ledger — from an earlier upload or entered by hand — are skipped.'}
            </span>
            <span className="tabular-nums">
              Buy {formatCurrency(totals.buy, currency)}
              {totals.sell > 0 && <> · Sell {formatCurrency(totals.sell, currency)}</>} · Charges{' '}
              {formatCurrency(totals.charges, currency)}
            </span>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Tile label="Booked" value={result.imported} tone="text-success" />
            <Tile label="Already on ledger" value={result.skipped ?? 0} />
            <Tile label="Failed" value={result.failed} tone={result.failed ? 'text-danger' : undefined} />
          </div>
          <div className="max-h-72 overflow-auto rounded-[12px] border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-xs text-ink-tertiary">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Row</th>
                  <th className="px-3 py-2 text-left font-medium">Symbol</th>
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
                          <CheckCircle2 className="h-3.5 w-3.5" /> Booked
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
        </div>
      )}
    </Modal>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-surface-2 px-3 py-2.5">
      <p className="text-xs text-ink-secondary">{label}</p>
      <p className={cn('value-display text-xl font-semibold', tone ?? 'text-ink')}>{value}</p>
    </div>
  );
}
