'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, FileWarning, Info } from 'lucide-react';
import { useMarket } from '@/components/layout/MarketContext';
import { Badge, Button, EmptyState, Modal, Select, Skeleton, Textarea, useToast } from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  decodeSubject,
  loadSubject,
  loadSubjectOptions,
  type SubjectData,
  type SubjectOption,
  type SubjectValue,
} from '@/lib/reportSubject';
import { analyseRisk, downloadRiskReportPdf, type RiskAnalysis } from '@/lib/riskReportPdf';
import { downloadReviewPackPdf } from '@/lib/reviewPackPdf';
import { downloadClientHoldingsWorkbook, downloadFamilyHoldingsWorkbook, type HoldingsExportRow } from '@/lib/holdingsExport';
import { portfolioHistoryApi, type PeriodOption, type PeriodReturn } from '@/lib/portfolio-history.api';
import { familyPerformanceApi } from '@/lib/family-performance.api';

/**
 * The generate dialog behind the Holdings Statement, Client Review Pack and
 * Risk & Exposure Report cards.
 *
 * One component for three reports rather than three dialogs, because the three
 * ask the same questions — which subject, and (for the review pack) which
 * period — and show the same kind of answer: what the file will contain, before
 * it is written. The preview is the point. These documents go to clients, and
 * a Generate button that writes a file straight to disk gives an adviser no
 * moment in which to notice that the subject is wrong or the book is empty.
 *
 * What varies per report is declared in `REPORTS` below; everything else here
 * is shared.
 */

export type ReportId = 'holdings-statement' | 'client-review' | 'risk-report';

interface ReportSpec {
  title: string;
  /** Sub-line under the dialog title. */
  subtitle: string;
  format: 'PDF' | 'XLSX';
  /** Whether the report is measured over a period and needs the period picker. */
  needsPeriod: boolean;
  /** Whether the report carries adviser commentary. */
  needsCommentary: boolean;
}

const REPORTS: Record<ReportId, ReportSpec> = {
  'holdings-statement': {
    title: 'Holdings Statement',
    subtitle: 'Full position-level breakdown with cost basis, market value and sector allocation.',
    format: 'XLSX',
    needsPeriod: false,
    needsCommentary: false,
  },
  'client-review': {
    title: 'Client Review Pack',
    subtitle: 'The quarterly review document — return, allocation, holdings and your commentary.',
    format: 'PDF',
    needsPeriod: true,
    needsCommentary: true,
  },
  'risk-report': {
    title: 'Risk & Exposure Report',
    subtitle: 'Concentration limits, sector exposure and a composition score.',
    format: 'PDF',
    needsPeriod: false,
    needsCommentary: false,
  },
};

/** Money in the subject's own currency, with Indian grouping for INR. */
function useMoney(currency: string) {
  return useMemo(
    () => (n: number) =>
      n.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 0,
      }),
    [currency],
  );
}

const pctOf = (v: number) => `${(v * 100).toFixed(1)}%`;

/** A small labelled figure in the preview's summary strip. */
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'warning' }) {
  return (
    <div className="rounded-[10px] border border-border bg-surface px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-tertiary">{label}</p>
      <p
        className={cn(
          'mt-1 text-[16px] font-semibold tabular-nums text-ink',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function ReportGeneratorModal({
  reportId,
  onClose,
}: {
  /** Null closes the dialog. */
  reportId: ReportId | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { market, ready: marketReady } = useMarket();

  const [options, setOptions] = useState<SubjectOption[] | null>(null);
  const [subjectValue, setSubjectValue] = useState<SubjectValue>('');
  const [data, setData] = useState<SubjectData | null>(null);
  const [loading, setLoading] = useState(false);

  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [period, setPeriod] = useState('');
  const [periodReturn, setPeriodReturn] = useState<PeriodReturn | null>(null);
  const [periodLoading, setPeriodLoading] = useState(false);

  const [commentary, setCommentary] = useState('');
  const [generating, setGenerating] = useState(false);

  const spec = reportId ? REPORTS[reportId] : null;
  const isOpen = reportId !== null;

  const money = useMoney(data?.currency ?? (market === 'INDIA' ? 'INR' : 'USD'));

  // The subject roster, loaded once per book while the dialog is open.
  useEffect(() => {
    if (!isOpen || !marketReady) return;
    let live = true;
    setOptions(null);
    loadSubjectOptions(market)
      .then((rows) => {
        if (!live) return;
        setOptions(rows);
        // Open on the first subject so the dialog shows a real report rather
        // than an empty frame the user has to populate before seeing anything.
        setSubjectValue(rows.length ? rows[0].value : '');
      })
      .catch(() => {
        if (!live) return;
        setOptions([]);
        toast({ tone: 'error', title: 'Could not load clients' });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, market, marketReady]);

  // The selected subject's positions.
  useEffect(() => {
    const subject = subjectValue ? decodeSubject(subjectValue) : null;
    if (!subject) {
      setData(null);
      return;
    }
    let live = true;
    setLoading(true);
    loadSubject(subject, market)
      .then((d) => live && setData(d))
      .catch(() => {
        if (!live) return;
        setData(null);
        toast({ tone: 'error', title: 'Could not load the portfolio' });
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectValue, market]);

  /**
   * The period options, for the review pack only.
   *
   * Fetched per subject because the windows are generated from that subject's
   * own market calendar — an Indian mandate is offered fiscal quarters (Q2 FY27)
   * and a US one calendar quarters, and offering the wrong set would label the
   * pack with a period the client's statements never use.
   */
  useEffect(() => {
    const subject = subjectValue ? decodeSubject(subjectValue) : null;
    if (!spec?.needsPeriod || !subject) {
      setPeriods([]);
      setPeriod('');
      return;
    }
    let live = true;
    const fetcher =
      subject.kind === 'family'
        ? familyPerformanceApi.periods(subject.id)
        : portfolioHistoryApi.periods(subject.id);

    fetcher
      .then((rows) => {
        if (!live) return;
        setPeriods(rows);
        // Default to the first quarter offered, falling back to whatever the
        // server lists first — this is a QUARTERLY pack, so a quarter is the
        // right default even though the API leads with QTD/FYTD.
        const quarter = rows.find((r) => r.group === 'Quarters');
        setPeriod(quarter?.code ?? rows[0]?.code ?? '');
      })
      .catch(() => {
        if (!live) return;
        setPeriods([]);
        setPeriod('');
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectValue, spec?.needsPeriod]);

  // The selected period's return.
  useEffect(() => {
    const subject = subjectValue ? decodeSubject(subjectValue) : null;
    if (!spec?.needsPeriod || !subject || !period) {
      setPeriodReturn(null);
      return;
    }
    let live = true;
    setPeriodLoading(true);
    const fetcher =
      subject.kind === 'family'
        ? familyPerformanceApi.periodReturn(subject.id, period as any)
        : portfolioHistoryApi.periodReturn(subject.id, period as any);

    fetcher
      .then((pr) => live && setPeriodReturn(pr as unknown as PeriodReturn))
      .catch(() => {
        if (!live) return;
        // A missing return is not a failed dialog: the pack still prints, and
        // says the return was unavailable rather than inventing one.
        setPeriodReturn(null);
      })
      .finally(() => live && setPeriodLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectValue, period, spec?.needsPeriod]);

  // A subject chosen in one book must not survive a switch to the other — its
  // report would be denominated in the wrong currency.
  useEffect(() => {
    setSubjectValue('');
    setData(null);
  }, [market]);

  // Commentary is per-report-run, not per-subject: carrying one client's
  // paragraph over to the next client's pack is the worst possible bug here.
  useEffect(() => {
    setCommentary('');
  }, [subjectValue, reportId]);

  const analysis: RiskAnalysis | null = useMemo(() => {
    if (!data) return null;
    return analyseRisk({
      subject: data.name,
      subjectKind: data.kind,
      currency: data.currency,
      asOf: new Date(),
      positions: data.positions,
      cashBalance: data.cashBalance,
      memberCount: data.memberCount,
    });
  }, [data]);

  const handleGenerate = async () => {
    if (!data || !reportId || !analysis) return;
    setGenerating(true);
    const asOf = new Date();

    try {
      if (reportId === 'holdings-statement') {
        const rows: HoldingsExportRow[] = analysis.positions.map((p, i) => ({
          srNo: i + 1,
          symbol: p.symbol,
          name: p.name,
          sector: p.sector,
          quantity: p.quantity,
          averageCostBasis: p.quantity ? p.costBasis / p.quantity : 0,
          costBasisTotal: p.costBasis,
          lastPrice: p.quantity ? p.currentValue / p.quantity : 0,
          currentValue: p.currentValue,
          pl: p.pl,
          plPercent: p.plPercent,
          // Weight comes from the analysis, which rebases on the portfolio
          // INCLUDING cash — the same denominator the workbook's own TOTAL row
          // uses, so the sheet's weights foot to 100%.
          allocPercent: p.weight * 100,
          ...(data.kind === 'family'
            ? { accounts: data.accountsBySymbol[p.symbol] ?? 1 }
            : {}),
        }));

        if (data.kind === 'family') {
          await downloadFamilyHoldingsWorkbook(data.name, rows, data.cashBalance);
        } else {
          await downloadClientHoldingsWorkbook(data.name, rows, data.cashBalance);
        }
      } else if (reportId === 'client-review') {
        downloadReviewPackPdf({
          subject: data.name,
          subjectKind: data.kind,
          currency: data.currency,
          asOf,
          periodReturn,
          positions: data.positions,
          cashBalance: data.cashBalance,
          commentary,
          memberCount: data.memberCount,
        });
      } else {
        downloadRiskReportPdf({
          subject: data.name,
          subjectKind: data.kind,
          currency: data.currency,
          asOf,
          positions: data.positions,
          cashBalance: data.cashBalance,
          memberCount: data.memberCount,
        });
      }

      toast({
        tone: 'success',
        title: `${spec?.title} generated`,
        description: `${data.name} · ${spec?.format} downloaded`,
      });
      onClose();
    } catch {
      toast({ tone: 'error', title: `Could not generate the ${spec?.title.toLowerCase()}` });
    } finally {
      setGenerating(false);
    }
  };

  if (!spec) return null;

  const breaches = analysis?.findings.filter((f) => f.severity === 'breach') ?? [];
  const empty = !loading && data !== null && data.positions.length === 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" title={spec.title} description={spec.subtitle}>
      <div className="space-y-5">
        {/* Controls */}
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[240px] flex-1">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
              Subject
            </span>
            <Select
              value={subjectValue}
              onChange={(e) => setSubjectValue(e.target.value)}
              disabled={!options || options.length === 0}
              className="w-full"
            >
              {options === null && <option value="">Loading…</option>}
              {options?.length === 0 && <option value="">No clients in this book</option>}
              {options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </label>

          {spec.needsPeriod && (
            <label className="min-w-[200px]">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
                Period
              </span>
              <Select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                disabled={periods.length === 0}
                className="w-full"
              >
                {periods.length === 0 && <option value="">No periods available</option>}
                {periods.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </label>
          )}

          <Badge tone={spec.format === 'PDF' ? 'danger' : 'success'}>{spec.format}</Badge>
        </div>

        {/* Preview */}
        {loading && <Skeleton className="h-52 w-full" />}

        {!loading && !data && options?.length === 0 && (
          <EmptyState
            icon={<FileWarning className="h-6 w-6" />}
            title="No clients in this book"
            description="Add a client to the selected market before generating a report."
          />
        )}

        {!loading && data && analysis && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Portfolio value" value={money(analysis.portfolioValue)} />
              <Stat label="Positions" value={String(analysis.positionCount)} />
              <Stat label="Sectors" value={String(analysis.sectorCount)} />
              <Stat label="Cash weight" value={pctOf(analysis.cashWeight)} />
            </div>

            {empty && (
              <div className="flex gap-3 rounded-[10px] border border-warning/30 bg-warning-soft p-4">
                <AlertTriangle className="h-4.5 w-4.5 shrink-0 text-warning" />
                <div className="text-[13px] leading-relaxed text-ink-secondary">
                  <p className="mb-0.5 font-semibold text-ink">This portfolio holds no open positions</p>
                  <p>
                    The report will generate, but every exposure figure in it will read zero because
                    there is nothing held — not because the portfolio is diversified.
                  </p>
                </div>
              </div>
            )}

            {/* The risk report leads with its limits; the others lead with the book. */}
            {reportId === 'risk-report' && !empty && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat
                    label="Composition score"
                    value={`${analysis.score} / 100 · ${analysis.scoreBand}`}
                    tone={analysis.score < 35 ? 'danger' : analysis.score < 55 ? 'warning' : undefined}
                  />
                  <Stat label="Effective holdings" value={analysis.effectiveHoldings.toFixed(1)} />
                  <Stat
                    label="Limit checks"
                    value={breaches.length ? `${breaches.length} over limit` : 'All within limit'}
                    tone={breaches.length ? 'danger' : undefined}
                  />
                </div>

                <div className="overflow-hidden rounded-[10px] border border-border">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
                        <th className="px-3 py-2">Measure</th>
                        <th className="px-3 py-2 text-right">Portfolio</th>
                        <th className="px-3 py-2 text-right">Limit</th>
                        <th className="px-3 py-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {analysis.findings.map((f) => (
                        <tr key={f.label}>
                          <td className="px-3 py-2 text-[13px] text-ink">{f.label}</td>
                          <td className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-ink">
                            {f.value}
                          </td>
                          <td className="px-3 py-2 text-right text-[13px] tabular-nums text-ink-tertiary">
                            {f.limit}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Badge
                              tone={
                                f.severity === 'breach'
                                  ? 'danger'
                                  : f.severity === 'watch'
                                    ? 'warning'
                                    : 'success'
                              }
                            >
                              {f.severity === 'breach'
                                ? 'Over limit'
                                : f.severity === 'watch'
                                  ? 'Approaching'
                                  : 'Within limit'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {reportId === 'client-review' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat
                    label="Return"
                    value={
                      periodLoading
                        ? '…'
                        : periodReturn?.returnPct == null
                          ? 'Not available'
                          : `${periodReturn.returnPct > 0 ? '+' : ''}${(periodReturn.returnPct * 100).toFixed(2)}%`
                    }
                    tone={
                      periodReturn?.returnPct != null && periodReturn.returnPct < 0 ? 'danger' : undefined
                    }
                  />
                  <Stat
                    label="Benchmark"
                    value={
                      periodReturn?.benchmark?.interim == null
                        ? '—'
                        : `${periodReturn.benchmark.interim > 0 ? '+' : ''}${(periodReturn.benchmark.interim * 100).toFixed(2)}%`
                    }
                  />
                  <Stat
                    label="Difference"
                    value={
                      periodReturn?.alpha == null
                        ? '—'
                        : `${periodReturn.alpha > 0 ? '+' : ''}${(periodReturn.alpha * 100).toFixed(2)}%`
                    }
                    tone={periodReturn?.alpha != null && periodReturn.alpha < 0 ? 'danger' : undefined}
                  />
                </div>

                {!periodLoading && periodReturn?.returnPct == null && (
                  <div className="flex gap-3 rounded-[10px] border border-border bg-surface-2 p-3">
                    <Info className="h-4 w-4 shrink-0 text-ink-tertiary" />
                    <p className="text-[12px] leading-relaxed text-ink-secondary">
                      {periodReturn?.returnReason ??
                        'No return could be measured for this window. The pack will say so rather than printing a zero.'}
                    </p>
                  </div>
                )}

                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
                    Commentary <span className="normal-case text-ink-tertiary">(optional)</span>
                  </span>
                  <Textarea
                    rows={4}
                    value={commentary}
                    onChange={(e) => setCommentary(e.target.value)}
                    placeholder="What drove the quarter, what you changed, and what you are watching. Printed verbatim in the pack."
                  />
                </label>
              </div>
            )}

            {reportId === 'holdings-statement' && !empty && (
              <div className="overflow-hidden rounded-[10px] border border-border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
                      <th className="px-3 py-2">Symbol</th>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Sector</th>
                      <th className="px-3 py-2 text-right">Value</th>
                      <th className="px-3 py-2 text-right">Weight</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {analysis.positions.slice(0, 8).map((p) => (
                      <tr key={p.symbol}>
                        <td className="px-3 py-2 text-[13px] font-semibold text-ink">{p.symbol}</td>
                        <td className="max-w-[220px] truncate px-3 py-2 text-[13px] text-ink-secondary">
                          {p.name}
                        </td>
                        <td className="px-3 py-2 text-[13px] text-ink-tertiary">{p.sector}</td>
                        <td className="px-3 py-2 text-right text-[13px] tabular-nums text-ink">
                          {money(p.currentValue)}
                        </td>
                        <td className="px-3 py-2 text-right text-[13px] font-semibold tabular-nums text-ink">
                          {pctOf(p.weight)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {analysis.positions.length > 8 && (
                  <p className="border-t border-border bg-surface-2 px-3 py-2 text-[12px] text-ink-tertiary">
                    Showing the largest 8 of {analysis.positions.length} positions. The workbook
                    contains every position, plus the sector allocation block and its chart.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!data || generating || loading}
            loading={generating}
            leftIcon={<Download className="h-4 w-4" />}
          >
            Download {spec.format}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
