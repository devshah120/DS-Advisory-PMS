'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Gift, Landmark, ShieldAlert } from 'lucide-react';
import { reportsApi } from '@/lib/reports.api';
import { clientsApi } from '@/lib/clients.api';
import { downloadCapitalGainsWorkbook } from '@/lib/capitalGainsExport';
import { CapitalGainsReport, RealizedGainRow } from '@/types/reports';
import { Client } from '@/types';
import { useMarket } from '@/components/layout/MarketContext';
import { Card, CardHeader, Badge, Button, Select, useToast, EmptyState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * The capital-gains statement, on screen.
 *
 * Deliberately shaped like the workbook it exports rather than like a dashboard:
 * a reader who checks the screen against the file their CA received should find
 * the same figures in the same order. The export is the deliverable; this is the
 * preview and the control surface for it.
 *
 * Every number here is FIFO — see the API's analytics/calculators/tax-lots.ts.
 */

/** Money in the mandate's own currency, with Indian digit grouping for INR. */
function useMoney(currency: string) {
  return useCallback(
    (n: number) =>
      n.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 2,
      }),
    [currency],
  );
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * A gain/loss figure, coloured the way a broker statement colours it.
 * Zero is neutral rather than green — it is neither a gain nor a loss.
 */
function Money({ value, money }: { value: number; money: (n: number) => string }) {
  return (
    <span
      className={cn(
        'tabular-nums font-medium',
        value > 0 && 'text-emerald-600 dark:text-emerald-400',
        value < 0 && 'text-red-600 dark:text-red-400',
      )}
    >
      {money(value)}
    </span>
  );
}

function TermSummary({
  label,
  bucket,
  money,
  accent,
}: {
  label: string;
  bucket: { gains: number; losses: number; net: number; transactions: number };
  money: (n: number) => string;
  accent: 'info' | 'warning';
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <Badge tone={accent}>
          {bucket.transactions} {bucket.transactions === 1 ? 'lot' : 'lots'}
        </Badge>
      </div>
      <div className="text-2xl font-semibold mb-3">
        <Money value={bucket.net} money={money} />
      </div>
      {/*
        Gross gains and losses shown beneath the net, because set-off rules need
        them separately: an Indian short-term loss can offset either term, a
        long-term loss only long-term gains.
      */}
      <dl className="space-y-1 text-xs text-slate-500">
        <div className="flex justify-between">
          <dt>Gross gains</dt>
          <dd className="tabular-nums">{money(bucket.gains)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Gross losses</dt>
          <dd className="tabular-nums">({money(bucket.losses)})</dd>
        </div>
      </dl>
    </div>
  );
}

export function CapitalGainsPanel() {
  const { toast } = useToast();
  const { market, ready: marketReady } = useMarket();

  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [report, setReport] = useState<CapitalGainsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const money = useMoney(report?.currency ?? (market === 'INDIA' ? 'INR' : 'USD'));

  useEffect(() => {
    if (!marketReady) return;
    (async () => {
      try {
        const list = await clientsApi.list({ limit: 200, market });
        setClients(list);
        // Select the new book's first client rather than preserving the previous
        // id — that id belongs to the other book, and its statement would render
        // under the wrong currency and the wrong fiscal calendar.
        setClientId(list.length ? list[0].id : null);
        setYear(null);
        if (!list.length) setReport(null);
      } catch {
        toast({ tone: 'error', title: 'Could not load clients' });
        setClients([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, marketReady]);

  useEffect(() => {
    if (!clientId) return;
    let live = true;
    setLoading(true);
    (async () => {
      try {
        const data = await reportsApi.capitalGains(clientId, year ?? undefined);
        if (!live) return;
        setReport(data);
        // Adopt the year the server actually served, so the dropdown reflects
        // what is on screen when the request omitted a year.
        if (year === null && data.fiscalYear !== null) setYear(data.fiscalYear);
      } catch {
        if (live) {
          toast({ tone: 'error', title: 'Could not load capital gains' });
          setReport(null);
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, year]);

  const handleExport = async () => {
    if (!report) return;
    setExporting(true);
    try {
      await downloadCapitalGainsWorkbook(report);
      toast({ tone: 'success', title: 'Capital gains statement downloaded' });
    } catch {
      toast({ tone: 'error', title: 'Export failed' });
    } finally {
      setExporting(false);
    }
  };

  const rows: RealizedGainRow[] = useMemo(() => report?.summary?.rows ?? [], [report]);
  const summary = report?.summary ?? null;

  return (
    <Card padding="none">
      <CardHeader
        className="p-5"
        title="Capital Gains Statement"
        subtitle="FIFO cost basis · short/long-term split · ready for filing"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={clientId ?? ''}
              onChange={(e) => {
                setClientId(e.target.value || null);
                setYear(null);
              }}
              className="min-w-[180px]"
            >
              {(clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>

            <Select
              value={year ?? ''}
              onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
              disabled={!report?.availableYears.length}
              className="min-w-[110px]"
            >
              {(report?.availableYears ?? []).map((y) => (
                <option key={y} value={y}>
                  {/* Label comes from the server so FY/CY naming cannot drift. */}
                  {report?.allYears.find((a) => a.fiscalYear === y)?.label ?? y}
                </option>
              ))}
            </Select>

            <Button onClick={handleExport} disabled={!summary || exporting}>
              <Download className="h-4 w-4" />
              {exporting ? 'Exporting…' : 'Export Excel'}
            </Button>
          </div>
        }
      />

      <div className="p-5 space-y-5">
        {loading && <Skeleton className="h-64 w-full" />}

        {!loading && !summary && (
          <EmptyState
            icon={<Landmark className="h-6 w-6" />}
            title="No realized gains"
            description="This client has not sold any shares, so there is nothing to report yet."
          />
        )}

        {!loading && summary && (
          <>
            {/*
              The import-date warning sits ABOVE the numbers it affects. When lots
              carry bulk-import dates, everything classifies as short-term —
              overstating the client's tax. A reader must meet that before the
              split they would otherwise trust.
            */}
            {report?.hasSyntheticAcquisitionDates && (
              <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-4">
                <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="text-sm text-amber-900 dark:text-amber-200">
                  <p className="font-semibold mb-1">Holding periods are unreliable</p>
                  <p>
                    Some positions carry acquisition dates from a bulk data import rather than
                    actual contract notes. Their short-term / long-term split is likely wrong and
                    probably overstates short-term gains. Verify against contract notes before
                    filing.
                  </p>
                </div>
              </div>
            )}

            {report && report.unmatchedSales.length > 0 && (
              <div className="flex gap-3 rounded-lg border border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40 p-4">
                <ShieldAlert className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
                <div className="text-sm text-red-900 dark:text-red-200">
                  <p className="font-semibold mb-1">
                    {report.unmatchedSales.length} sale
                    {report.unmatchedSales.length === 1 ? '' : 's'} without a recorded purchase
                  </p>
                  <p>
                    No cost basis can be defended for these, so they are excluded from the totals
                    below. They appear on their own sheet in the export.
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <TermSummary
                label="Short Term"
                bucket={summary.shortTerm}
                money={money}
                accent="warning"
              />
              <TermSummary
                label="Long Term"
                bucket={summary.longTerm}
                money={money}
                accent="info"
              />
              <div className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Net {summary.label}
                  </span>
                </div>
                <div className="text-2xl font-semibold mb-3">
                  <Money value={summary.total.net} money={money} />
                </div>
                <dl className="space-y-1 text-xs text-slate-500">
                  <div className="flex justify-between">
                    <dt>Sale consideration</dt>
                    <dd className="tabular-nums">{money(summary.total.proceeds)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Cost of acquisition</dt>
                    <dd className="tabular-nums">{money(summary.total.costBasis)}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Security</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-left font-medium">Acquired</th>
                    <th className="px-3 py-2 text-left font-medium">Sold</th>
                    <th className="px-3 py-2 text-right font-medium">Days</th>
                    <th className="px-3 py-2 text-left font-medium">Term</th>
                    <th className="px-3 py-2 text-right font-medium">Cost</th>
                    <th className="px-3 py-2 text-right font-medium">Proceeds</th>
                    <th className="px-3 py-2 text-right font-medium">Gain / (Loss)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.map((r, i) => (
                    <tr
                      key={`${r.ticker}-${r.acquiredOn}-${r.soldOn}-${i}`}
                      className="hover:bg-slate-50 dark:hover:bg-slate-900/40"
                    >
                      <td className="px-3 py-2 font-medium">
                        <div className="flex items-center gap-1.5">
                          {r.ticker}
                          {/* A nil-cost bonus lot makes the whole proceeds a gain —
                              flagged so the row does not read as an error. */}
                          {r.fromBonus && (
                            <Gift className="h-3.5 w-3.5 text-violet-500" aria-label="Bonus issue" />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.quantity}</td>
                      <td className="px-3 py-2 text-slate-500">{fmtDate(r.acquiredOn)}</td>
                      <td className="px-3 py-2 text-slate-500">{fmtDate(r.soldOn)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        {r.holdingDays}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={r.term === 'LONG' ? 'info' : 'warning'}>
                          {r.term === 'LONG' ? 'Long' : 'Short'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(r.costBasis)}
                        {r.grandfathered && (
                          <span
                            className="ml-1 text-[10px] text-violet-500"
                            title={`s.112A grandfathered — actual cost ${r.originalCostPerShare.toFixed(2)}/share`}
                          >
                            §112A
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(r.proceeds)}</td>
                      <td className="px-3 py-2 text-right">
                        <Money value={r.gain} money={money} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 dark:bg-slate-900/60 font-semibold">
                  <tr>
                    <td className="px-3 py-2" colSpan={6}>
                      Total · {summary.total.transactions} lot
                      {summary.total.transactions === 1 ? '' : 's'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(summary.total.costBasis)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(summary.total.proceeds)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Money value={summary.total.net} money={money} />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="text-xs text-slate-500">
              One row per tax lot sold, oldest first (FIFO). A sale spanning several purchase lots
              appears as several rows — the same way a broker contract note itemises it.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
