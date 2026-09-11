'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
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
import {
  downloadClientFeeWorkbook,
  downloadFamilyInvoiceWorkbook,
} from '@/lib/feeExport';
import {
  ClientFeeRow,
  FeeQuarterOption,
  FamilyFeeInvoice,
  InvoiceableFamily,
  proratedTrancheCount,
} from '@/types/reports';
import { CapitalGainsPanel } from '@/components/reports/CapitalGainsPanel';
/**
 * Loaded on demand. The generator carries the PDF renderer behind it and is
 * only reachable by clicking one card, so it has no business in the weight of
 * a page whose main job is the fee table.
 */
const PerformanceSummaryModal = dynamic(
  () =>
    import('@/components/reports/PerformanceSummaryModal').then(
      (m) => m.PerformanceSummaryModal,
    ),
  { ssr: false },
);
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
  /**
   * True once this template has a real generator wired to it, rather than the
   * placeholder that toasts without producing a file. Drives both the click
   * behaviour and the "Ready" badge, so the card cannot claim to work while
   * still being a stub.
   */
  generator?: boolean;
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
    // "across all mandates" was a promise the card could not keep: a return is
    // only meaningful for one subject over one window, and there is no
    // firm-wide XIRR to report. It now says what it actually produces.
    description: 'Returns, benchmark comparison and alpha for one mandate or household, over the period you choose.',
    icon: <FileBarChart className="h-5 w-5" />,
    cadence: 'Monthly',
    format: 'PDF',
    generator: true,
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
  /**
   * Which template's own generator is open, if any.
   *
   * A report that has a real generator behind it opens that generator; the rest
   * still fall through to the placeholder below. Held as the template id rather
   * than a boolean so the remaining cards can be given their own panels one at
   * a time without this becoming a row of separate flags.
   */
  const [openGenerator, setOpenGenerator] = useState<string | null>(null);

  const [fees, setFees] = useState<ClientFeeRow[]>([]);
  const [feesLoading, setFeesLoading] = useState(true);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const [quarters, setQuarters] = useState<FeeQuarterOption[]>([]);
  // Empty string = the current quarter (what the backend serves with no
  // ?quarter=), and also "All clients" for the client filter.
  const [quarter, setQuarter] = useState('');
  const [clientFilter, setClientFilter] = useState('');

  // --- household invoicing ---
  /**
   * The subject of the fee view: the whole book, one client, or one household.
   *
   * Encoded as a single prefixed value ('client:<id>' / 'family:<id>') in ONE
   * selector rather than as a separate control, because a reviewer moves
   * between "bill the family" and "check one account" constantly. A second
   * dropdown would make that a two-step act, and two independent filters could
   * also be set to contradict each other.
   */
  const [families, setFamilies] = useState<InvoiceableFamily[]>([]);
  const [familyId, setFamilyId] = useState('');
  const [invoice, setInvoice] = useState<FamilyFeeInvoice | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

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

  /**
   * The book's households. A failure here leaves the page billing individual
   * mandates only — its primary job — rather than failing outright.
   */
  useEffect(() => {
    if (!marketReady) return;
    let mounted = true;
    reportsApi
      .invoiceableFamilies(market)
      .then((rows) => mounted && setFamilies(rows))
      .catch(() => mounted && setFamilies([]));
    return () => {
      mounted = false;
    };
  }, [market, marketReady]);

  /**
   * The selected household's invoice, fetched per household and per quarter.
   *
   * Deliberately server-side rather than assembled in the browser from `fees`:
   * the backend reads the family's own book (which may differ from the viewer's
   * market selector), applies the ownership boundary, and reuses the same
   * frozen fee rows an individual statement would. Rebuilding that here is how
   * two documents end up disagreeing about one bill.
   */
  useEffect(() => {
    if (!familyId) {
      setInvoice(null);
      return;
    }
    let mounted = true;
    setInvoiceLoading(true);
    reportsApi
      .familyInvoice(familyId, quarter || undefined)
      .then((inv) => mounted && setInvoice(inv))
      .catch(() => {
        if (!mounted) return;
        setInvoice(null);
        toast({ tone: 'error', title: 'Failed to load the household invoice' });
      })
      .finally(() => mounted && setInvoiceLoading(false));
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, quarter]);

  // A household selected in one book must not stay selected across a switch:
  // its invoice would be denominated in the other book's currency.
  useEffect(() => {
    setFamilyId('');
  }, [market]);

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
    // A template with a real generator opens it: a Performance Summary is
    // about ONE subject over ONE window, and neither can be guessed from a
    // click on a card. The rest keep the placeholder until they are built out.
    if (tpl.generator) {
      setOpenGenerator(tpl.id);
      return;
    }
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

  /** The household bill, as one workbook itemised by account. */
  const exportInvoice = async () => {
    if (!invoice) return;
    setExportingId(invoice.familyId);
    try {
      await downloadFamilyInvoiceWorkbook(invoice);
      toast({
        tone: 'success',
        title: `Invoice exported — ${invoice.familyName}`,
        description: `${invoice.totals.billedCount} account${
          invoice.totals.billedCount === 1 ? '' : 's'
        } · ${invoice.quarterLabel}`,
      });
    } catch {
      toast({ tone: 'error', title: 'Failed to export the invoice' });
    } finally {
      setExportingId(null);
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
                  <div className="flex items-center gap-1.5">
                    {/* Says which cards actually produce a file. Without it the
                        six read as equals, and five of them are not. */}
                    {tpl.generator && <Badge tone="success">Ready</Badge>}
                    <Badge tone={formatTone[tpl.format]}>{tpl.format}</Badge>
                  </div>
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
                    leftIcon={
                      tpl.generator ? (
                        <ArrowRight className="h-3.5 w-3.5" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )
                    }
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

        {/* Capital Gains — FIFO, cut on the client's own fiscal calendar. */}
        <CapitalGainsPanel />

        {/* Fee Schedule */}
        <Card padding="none">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5">
            <CardHeader
              title={familyId && invoice ? `Invoice — ${invoice.familyName}` : 'Fee Schedule'}
              subtitle={
                familyId && invoice
                  ? `${invoice.quarterLabel} · one bill for ${invoice.totals.billedCount} of ` +
                    `${invoice.totals.memberCount} account${
                      invoice.totals.memberCount === 1 ? '' : 's'
                    }, each charged at its own rate`
                  : selectedQuarter
                    ? `${selectedQuarter.label} · ${
                        selectedQuarter.closed
                          ? 'closed — billed on quarter-end value'
                          : 'in progress — estimated on live value'
                      }, prorated by inception date`
                    : 'Management fees, prorated by inception date'
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              {/* One selector, two groups. Picking a household switches the
                  card to its invoice; picking a client filters the fee table
                  as before. Prefixed values because a family id and a client
                  id are both opaque cuids. */}
              <Select
                value={familyId ? `family:${familyId}` : clientFilter ? `client:${clientFilter}` : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.startsWith('family:')) {
                    setFamilyId(v.slice('family:'.length));
                    setClientFilter('');
                  } else if (v.startsWith('client:')) {
                    setClientFilter(v.slice('client:'.length));
                    setFamilyId('');
                  } else {
                    setClientFilter('');
                    setFamilyId('');
                  }
                }}
                aria-label="Client or household"
              >
                <option value="">All clients</option>
                {families.length > 0 && (
                  <optgroup label="Households (invoice)">
                    {families.map((f) => (
                      <option key={f.id} value={`family:${f.id}`}>
                        {f.name} · {f.memberCount}{' '}
                        {f.memberCount === 1 ? 'account' : 'accounts'}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label={families.length > 0 ? 'Individual accounts' : 'Accounts'}>
                  {clientOptions.map((c) => (
                    <option key={c.id} value={`client:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
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
              {familyId ? (
                <Button
                  size="sm"
                  leftIcon={<Download className="h-3.5 w-3.5" />}
                  disabled={invoiceLoading || !invoice || invoice.lines.length === 0}
                  loading={exportingId === familyId}
                  onClick={exportInvoice}
                >
                  Export invoice
                </Button>
              ) : (
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
              )}
            </div>
          </div>
          {familyId ? (
            <FamilyInvoiceView invoice={invoice} loading={invoiceLoading} />
          ) : (
          <table className="w-full">
            <thead>
              <tr className="border-y border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
                <th className="px-5 py-2.5">Client</th>
                <th className="px-5 py-2.5 text-right">Annual Rate</th>
                <th className="px-5 py-2.5 text-right">Billable Capital</th>
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
                      {/*
                        The day-count above is the OPENING book's. Capital
                        deployed mid-quarter is billed over its own, shorter
                        window, so the row says how many such tranches exist
                        rather than implying one number covers the whole fee.
                      */}
                      {proratedTrancheCount(f) > 0 && (
                        <div className="text-[11px] text-ink-tertiary">
                          +{proratedTrancheCount(f)} prorated
                        </div>
                      )}
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
          )}
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

      {/* The Performance Summary's own generator. Mounted here rather than
          inside the card so the modal is not unmounted by a re-render of the
          template grid mid-selection. */}
      <PerformanceSummaryModal
        isOpen={openGenerator === 'perf-summary'}
        onClose={() => setOpenGenerator(null)}
      />
    </>
  );
}

/**
 * The household invoice, as it appears on screen.
 *
 * Same columns as the fee table it replaces, so a reader moving between "the
 * whole book" and "this family" is reading the same document at two scopes
 * rather than learning a second layout. The additions are the ones a bill
 * needs and a table does not: an estimate banner, a household total, and the
 * accounts that were not billable.
 */
function FamilyInvoiceView({
  invoice,
  loading,
}: {
  invoice: FamilyFeeInvoice | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="px-5 py-8 text-center text-[13px] text-ink-tertiary">
        Loading invoice…
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="px-5 py-8 text-center text-[13px] text-ink-tertiary">
        No invoice for this household.
      </div>
    );
  }

  const money = invoice.currency;

  return (
    <div>
      {/* An open quarter is an estimate. Said before the figures, not after —
          a household bill mistaken for a final one gets paid. */}
      {invoice.isEstimate && (
        <div className="flex items-start gap-2.5 border-b border-amber-200 bg-amber-50 px-5 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-[12px] leading-relaxed text-amber-900">
            <span className="font-semibold">Estimate</span> — {invoice.quarterLabel} has not
            closed. These figures use live portfolio values and will change before the quarter is
            billed.
          </p>
        </div>
      )}

      <table className="w-full">
        <thead>
          <tr className="border-y border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
            <th className="px-5 py-2.5">Account</th>
            <th className="px-5 py-2.5 text-right">Annual Rate</th>
            <th className="px-5 py-2.5 text-right">Billable Capital</th>
            <th className="px-5 py-2.5 text-right">Days Billed</th>
            <th className="px-5 py-2.5 text-right">Fee Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {invoice.lines.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-5 py-8 text-center text-[13px] text-ink-tertiary">
                No account in this household was billable for {invoice.quarterLabel}.
              </td>
            </tr>
          ) : (
            invoice.lines.map((line) => (
              <tr key={line.clientId} className="hover:bg-surface-2">
                <td className="px-5 py-3 text-[13px] font-medium text-ink">{line.clientName}</td>
                <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink-secondary">
                  {line.feeRatePercent.toFixed(2)}%
                </td>
                <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink-secondary">
                  {formatCurrency(line.portfolioValue, line.currency || money)}
                </td>
                <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink-tertiary">
                  {line.daysBilled} / {line.daysInQuarter}
                  {/* See the fee table: the count is the opening book's alone. */}
                  {proratedTrancheCount(line) > 0 && (
                    <div className="text-[11px] text-ink-tertiary">
                      +{proratedTrancheCount(line)} prorated
                    </div>
                  )}
                </td>
                <td className="px-5 py-3 text-right text-[13px] font-semibold tabular-nums text-ink">
                  {formatCurrency(line.feeAmount, line.currency || money)}
                </td>
              </tr>
            ))
          )}
        </tbody>
        {invoice.lines.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-border bg-surface-2">
              <td className="px-5 py-3 text-[13px] font-semibold text-ink">
                Total due
                {invoice.totals.effectiveAnnualRatePercent !== null && (
                  // An effective rate, not one anyone was charged — labelled so
                  // it is never quoted back as the household's headline rate.
                  <span className="ml-2 font-normal text-[12px] text-ink-tertiary">
                    {invoice.totals.effectiveAnnualRatePercent.toFixed(2)}% effective
                  </span>
                )}
              </td>
              <td />
              <td className="px-5 py-3 text-right text-[13px] font-semibold tabular-nums text-ink">
                {formatCurrency(invoice.totals.portfolioValue, money)}
              </td>
              <td />
              <td className="px-5 py-3 text-right text-[14px] font-semibold tabular-nums text-ink">
                {formatCurrency(invoice.totals.feeAmount, money)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>

      {/* Named, not dropped: a household bill missing an account still looks
          complete, and the family is least able to notice the omission. */}
      {invoice.unbilled.length > 0 && (
        <div className="border-t border-border px-5 py-4">
          <p className="text-[12px] font-semibold text-ink-secondary">
            Not billed this quarter
          </p>
          <ul className="mt-2 space-y-1">
            {invoice.unbilled.map((u) => (
              <li key={u.clientId} className="text-[12px] text-ink-tertiary">
                <span className="font-medium text-ink-secondary">{u.clientName}</span> — {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
