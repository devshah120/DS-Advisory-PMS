'use client';

import { useEffect, useState } from 'react';
import {
  FileText,
  FileBarChart,
  FileSpreadsheet,
  ShieldCheck,
  Landmark,
  CalendarClock,
  Download,
  ArrowRight,
  Percent,
} from 'lucide-react';
import { formatDate, formatCurrency, formatPct, cn } from '@/lib/utils';
import { reportsApi } from '@/lib/reports.api';
import { downloadClientFeeWorkbook } from '@/lib/feeExport';
import { ClientFeeRow, FeeQuarterOption } from '@/types/reports';
import { usePageHeading } from '@/components/layout/PageHeaderContext';
import { useMarket } from '@/components/layout/MarketContext';
import { Card, CardHeader, Badge, Button, Select, useToast } from '@/components/ui';

interface ReportTemplate {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  cadence: string;
  format: 'PDF' | 'XLSX' | 'CSV';
}

interface GeneratedReport {
  id: string;
  name: string;
  type: string;
  period: string;
  createdAt: Date;
  format: 'PDF' | 'XLSX' | 'CSV';
  status: 'ready' | 'processing';
}

const templates: ReportTemplate[] = [
  {
    id: 'perf-summary',
    title: 'Performance Summary',
    description: 'Returns, attribution, and benchmark comparison across all mandates.',
    icon: <FileBarChart className="h-5 w-5" />,
    cadence: 'Monthly',
    format: 'PDF',
  },
  {
    id: 'holdings-statement',
    title: 'Holdings Statement',
    description: 'Full position-level breakdown with cost basis and market value.',
    icon: <FileSpreadsheet className="h-5 w-5" />,
    cadence: 'On demand',
    format: 'XLSX',
  },
  {
    id: 'client-review',
    title: 'Client Review Pack',
    description: 'Client-ready quarterly review with commentary and allocation.',
    icon: <FileText className="h-5 w-5" />,
    cadence: 'Quarterly',
    format: 'PDF',
  },
  {
    id: 'risk-report',
    title: 'Risk & Exposure Report',
    description: 'Concentration, sector exposure, and risk score analytics.',
    icon: <ShieldCheck className="h-5 w-5" />,
    cadence: 'Weekly',
    format: 'PDF',
  },
  {
    id: 'tax-lots',
    title: 'Realized Gains / Tax Lots',
    description: 'Realized P&L and tax-lot detail for the selected period.',
    icon: <Landmark className="h-5 w-5" />,
    cadence: 'Annual',
    format: 'CSV',
  },
  {
    id: 'transactions',
    title: 'Transaction Ledger',
    description: 'Complete trade and cash activity log across accounts.',
    icon: <CalendarClock className="h-5 w-5" />,
    cadence: 'On demand',
    format: 'CSV',
  },
];

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);

const recentReports: GeneratedReport[] = [
  { id: 'r1', name: 'Performance Summary — Jun 2026', type: 'Performance', period: 'Jun 2026', createdAt: daysAgo(1), format: 'PDF', status: 'ready' },
  { id: 'r2', name: 'Client Review Pack — Q2 2026', type: 'Client Review', period: 'Q2 2026', createdAt: daysAgo(2), format: 'PDF', status: 'ready' },
  { id: 'r3', name: 'Holdings Statement — Hudson Family Office', type: 'Holdings', period: 'Jun 2026', createdAt: daysAgo(4), format: 'XLSX', status: 'ready' },
  { id: 'r4', name: 'Risk & Exposure Report — Wk 26', type: 'Risk', period: 'Week 26', createdAt: daysAgo(6), format: 'PDF', status: 'processing' },
  { id: 'r5', name: 'Transaction Ledger — May 2026', type: 'Transactions', period: 'May 2026', createdAt: daysAgo(11), format: 'CSV', status: 'ready' },
];

/** Sentinel for `exportingId` — the bulk export isn't any one client's row. */
const ALL_EXPORT_ID = '__all__';

const formatTone: Record<GeneratedReport['format'], any> = {
  PDF: 'danger',
  XLSX: 'success',
  CSV: 'info',
};

export default function ReportsPage() {
  const { toast } = useToast();
  // The fee table is scoped to the selected book; `currency` is its fallback
  // unit for the total, while each row renders in the client's own currency.
  const { market, meta, ready: marketReady } = useMarket();
  const currency = meta.currency;
  const [generating, setGenerating] = useState<string | null>(null);

  const [fees, setFees] = useState<ClientFeeRow[]>([]);
  const [feesLoading, setFeesLoading] = useState(true);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const [quarters, setQuarters] = useState<FeeQuarterOption[]>([]);
  // Empty string = the current quarter (what the backend serves with no
  // ?quarter=), and also "All clients" for the client filter.
  const [quarter, setQuarter] = useState('');
  const [clientFilter, setClientFilter] = useState('');

  useEffect(() => {
    let mounted = true;
    reportsApi
      .feeQuarters()
      .then((rows) => {
        if (!mounted) return;
        setQuarters(rows);
        // Default to the newest quarter so the page opens on "now" as before.
        if (rows.length > 0) setQuarter(rows[0].code);
      })
      .catch(() => mounted && toast({ tone: 'error', title: 'Failed to load quarters' }));
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refetches whenever the quarter changes. The client filter is applied
  // client-side below — every client's row for a quarter arrives in one call,
  // so filtering locally avoids a round trip per selection.
  useEffect(() => {
    if (!marketReady) return;
    let mounted = true;
    setFeesLoading(true);
    reportsApi
      // Scoped to the selected book: the table totals its rows, and an
      // unscoped read would sum USD and INR fees into one meaningless figure.
      .fees(quarter || undefined, market)
      .then((rows) => mounted && setFees(rows))
      .catch(() => {
        if (!mounted) return;
        setFees([]);
        toast({ tone: 'error', title: 'Failed to load fee schedule' });
      })
      .finally(() => mounted && setFeesLoading(false));
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quarter, market, marketReady]);

  // Clients present in this quarter — derived from the rows themselves rather
  // than the full client list, so the dropdown can't offer a client who wasn't
  // billable in the selected quarter and would render an empty table.
  const clientOptions = fees
    .map((f) => ({ id: f.clientId, name: f.clientName }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // A client selected in one quarter may not be billable in the next one
  // chosen. Falling back to all clients keeps the table populated rather than
  // showing an empty result under a still-selected name.
  const clientInQuarter = fees.some((f) => f.clientId === clientFilter);
  const visibleFees = clientFilter && clientInQuarter
    ? fees.filter((f) => f.clientId === clientFilter)
    : fees;

  const selectedQuarter = quarters.find((q) => q.code === quarter);

  const handleGenerate = (tpl: ReportTemplate) => {
    setGenerating(tpl.id);
    setTimeout(() => {
      setGenerating(null);
      toast({ tone: 'success', title: `${tpl.title} generated`, description: `${tpl.format} ready to download` });
    }, 900);
  };

  const exportClientFee = async (fee: ClientFeeRow) => {
    setExportingId(fee.clientId);
    try {
      await downloadClientFeeWorkbook(fee);
    } catch {
      toast({ tone: 'error', title: `Failed to export ${fee.clientName}` });
    } finally {
      setExportingId(null);
    }
  };

  /**
   * One workbook per visible client. Sequential rather than concurrent: each
   * download is a separate browser save, and firing them all at once makes
   * browsers drop all but the first.
   */
  const exportAll = async () => {
    setExportingId(ALL_EXPORT_ID);
    let failed = 0;
    for (const fee of visibleFees) {
      try {
        await downloadClientFeeWorkbook(fee);
      } catch {
        failed += 1;
      }
    }
    setExportingId(null);

    if (failed > 0) {
      toast({ tone: 'error', title: `${failed} of ${visibleFees.length} exports failed` });
    } else {
      toast({
        tone: 'success',
        title: `Exported ${visibleFees.length} fee schedule${visibleFees.length === 1 ? '' : 's'}`,
      });
    }
  };

  const totalFeeAmount = visibleFees.reduce((sum, f) => sum + f.feeAmount, 0);

  usePageHeading(
    {
      title: "Reports",
      subtitle: "Generate, schedule, and download portfolio reports",
      actions: (
        <Button
                  variant="outline"
                  leftIcon={<CalendarClock className="h-4 w-4" />}
                  onClick={() => toast({ tone: 'info', title: 'Scheduling coming soon' })}
                >
                  Schedule
                </Button>
      ),
    }
  );

  return (
    <>
      <div className="space-y-6">
        {/* Templates */}
        <div>
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-ink-tertiary">
            Report Library
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((tpl) => (
              <Card key={tpl.id} padding="md" hover className="flex flex-col">
                <div className="flex items-start justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-brand-soft text-brand">
                    {tpl.icon}
                  </span>
                  <Badge tone={formatTone[tpl.format]}>{tpl.format}</Badge>
                </div>
                <p className="mt-3 text-[15px] font-semibold text-ink">{tpl.title}</p>
                <p className="mt-1 flex-1 text-[13px] text-ink-secondary">{tpl.description}</p>
                <div className="mt-4 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs text-ink-tertiary">
                    <CalendarClock className="h-3.5 w-3.5" />
                    {tpl.cadence}
                  </span>
                  <Button
                    size="sm"
                    leftIcon={<Download className="h-3.5 w-3.5" />}
                    loading={generating === tpl.id}
                    onClick={() => handleGenerate(tpl)}
                  >
                    Generate
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Fee Schedule */}
        <Card padding="none">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5">
            <CardHeader
              title="Fee Schedule"
              subtitle={
                selectedQuarter
                  ? `${selectedQuarter.label} · ${
                      selectedQuarter.closed
                        ? 'closed — billed on quarter-end value'
                        : 'in progress — estimated on live value'
                    }, prorated by inception date`
                  : 'Management fees, prorated by inception date'
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                aria-label="Client"
              >
                <option value="">All clients</option>
                {clientOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
                aria-label="Quarter"
              >
                {quarters.map((q) => (
                  <option key={q.code} value={q.code}>
                    {q.label}
                    {q.closed ? '' : ' (in progress)'}
                  </option>
                ))}
              </Select>
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Download className="h-3.5 w-3.5" />}
                disabled={feesLoading || visibleFees.length === 0}
                loading={exportingId === ALL_EXPORT_ID}
                onClick={exportAll}
              >
                Export all
              </Button>
            </div>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-y border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
                <th className="px-5 py-2.5">Client</th>
                <th className="px-5 py-2.5 text-right">Annual Rate</th>
                <th className="px-5 py-2.5 text-right">Portfolio Value</th>
                <th className="px-5 py-2.5 text-right">Days Billed</th>
                <th className="px-5 py-2.5 text-right">Fee Amount</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5 text-right">Export</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {feesLoading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-[13px] text-ink-tertiary">
                    Loading…
                  </td>
                </tr>
              ) : visibleFees.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-[13px] text-ink-tertiary">
                    No clients were billable in {selectedQuarter?.label ?? 'this quarter'}.
                  </td>
                </tr>
              ) : (
                visibleFees.map((f) => (
                  <tr key={f.clientId} className="transition-colors hover:bg-surface-2">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-surface-3 text-ink-secondary">
                          <Percent className="h-4 w-4" />
                        </span>
                        <span className="text-[13px] font-medium text-ink">{f.clientName}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink-secondary">
                      {formatPct(f.feeRatePercent)}
                    </td>
                    <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink-secondary">
                      {formatCurrency(f.portfolioValue, f.currency ?? currency)}
                    </td>
                    <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink-tertiary">
                      {f.daysBilled} / {f.daysInQuarter}
                    </td>
                    <td className="px-5 py-3 text-right text-[13px] font-semibold tabular-nums text-ink">
                      {formatCurrency(f.feeAmount, f.currency ?? currency)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={f.isEstimate ? 'warning' : 'success'} dot>
                        {f.isEstimate ? 'Estimate' : 'Final'}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Download className="h-3.5 w-3.5" />}
                        loading={exportingId === f.clientId}
                        onClick={() => exportClientFee(f)}
                      >
                        Export
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {!feesLoading && visibleFees.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-surface-2">
                  <td className="px-5 py-3 text-[13px] font-semibold text-ink" colSpan={4}>
                    Total
                  </td>
                  <td className="px-5 py-3 text-right text-[13px] font-semibold tabular-nums text-ink">
                    {/* Every row is from one book, so the book's currency is the total's. */}
                    {formatCurrency(totalFeeAmount, currency)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </Card>

        {/* Recent reports */}
        <Card padding="none">
          <div className="flex items-center justify-between px-5 py-5">
            <CardHeader title="Recent Reports" subtitle="Generated in the last 30 days" />
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-y border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
                <th className="px-5 py-2.5">Report</th>
                <th className="px-5 py-2.5">Type</th>
                <th className="px-5 py-2.5">Period</th>
                <th className="px-5 py-2.5">Created</th>
                <th className="px-5 py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recentReports.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-surface-2">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-surface-3 text-ink-secondary">
                        <FileText className="h-4 w-4" />
                      </span>
                      <span className="text-[13px] font-medium text-ink">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-[13px] text-ink-secondary">{r.type}</td>
                  <td className="px-5 py-3 text-[13px] text-ink-secondary">{r.period}</td>
                  <td className="px-5 py-3 text-[13px] tabular-nums text-ink-tertiary">
                    {formatDate(r.createdAt)}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {r.status === 'ready' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        leftIcon={<Download className="h-3.5 w-3.5" />}
                        onClick={() => toast({ tone: 'success', title: `Downloading ${r.name}` })}
                      >
                        {r.format}
                      </Button>
                    ) : (
                      <Badge tone="warning" dot>
                        Processing
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
