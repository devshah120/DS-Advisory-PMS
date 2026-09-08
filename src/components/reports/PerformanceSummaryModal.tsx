'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, FileBarChart, Info } from 'lucide-react';
import { clientsApi } from '@/lib/clients.api';
import { familiesApi } from '@/lib/families.api';
import {
  portfolioHistoryApi,
  PeriodOption,
  PeriodReturn,
  PortfolioAsOf,
} from '@/lib/portfolio-history.api';
import {
  familyPerformanceApi,
  FamilyPeriodReturn,
} from '@/lib/family-performance.api';
import { Client, Family } from '@/types';
import { useMarket } from '@/components/layout/MarketContext';
import { isUsableRange, rangeHint, todayIso, INCEPTION_ISO } from '@/lib/custom-range';
import { cn } from '@/lib/utils';
import { Badge, Button, Input, Modal, Select, Skeleton, useToast } from '@/components/ui';

/**
 * "Generate a Performance Summary" — pick a subject, pick a window, see what
 * the document will say, then take the PDF.
 *
 * The preview is not decoration and is the reason this is a modal rather than a
 * one-click download. A Performance Summary is a client-facing document: it
 * goes out under the firm's letterhead, and the two ways it can embarrass the
 * sender are both invisible until it is opened. Either the window is not the
 * one intended — "Q2 FY27" resolving to a stub period because the mandate
 * opened in August — or the return could not be solved at all, and the file is
 * a statement of "Not available" that still looks like a statement. Showing the
 * headline before the download makes both of those a decision instead of a
 * discovery.
 *
 * Nothing here computes anything. Every figure comes from the same engine
 * endpoints the Performance page reads, and the file is rendered by the same
 * content builders as the workbook — so this modal, that page and the exported
 * document cannot disagree about a client's quarter.
 */

/** What the statement is about: one mandate, or one household. */
type Subject = { kind: 'client'; id: string } | { kind: 'family'; id: string };

const signedPct = (v: number, dp = 2) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * The two shapes the engine returns share every field this modal reads. Kept as
 * a narrow structural type rather than a union so the preview and the download
 * do not each need to branch on the subject's kind.
 */
type AnyReturn = PeriodReturn | FamilyPeriodReturn;

export function PerformanceSummaryModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const { market, ready: marketReady } = useMarket();

  const [clients, setClients] = useState<Client[] | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  const [subject, setSubject] = useState<Subject | null>(null);

  const [options, setOptions] = useState<PeriodOption[]>([]);
  const [period, setPeriod] = useState('QTD');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(todayIso());

  const [result, setResult] = useState<AnyReturn | null>(null);
  const [asOf, setAsOf] = useState<PortfolioAsOf | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noBaseline, setNoBaseline] = useState(false);
  const [generating, setGenerating] = useState(false);

  /**
   * The subjects available to report on, loaded when the modal opens rather
   * than with the page. The Reports page carries five other cards and a fee
   * table; fetching every client and household for a modal that may never be
   * opened would make all of them wait.
   */
  useEffect(() => {
    if (!isOpen || !marketReady) return;
    let live = true;
    (async () => {
      try {
        const [list, familyList] = await Promise.all([
          clientsApi.list({ limit: 200, market }),
          familiesApi.list(market).catch(() => [] as Family[]),
        ]);
        if (!live) return;
        setClients(list);
        setFamilies(familyList);
        // Households first when the book has any — a review opens on the
        // aggregate, and the individual accounts are one selection away.
        if (familyList.length) setSubject({ kind: 'family', id: familyList[0].id });
        else if (list.length) setSubject({ kind: 'client', id: list[0].id });
        else setSubject(null);
      } catch {
        if (!live) return;
        setClients([]);
        setFamilies([]);
        toast({ tone: 'error', title: 'Could not load clients' });
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, market, marketReady]);

  /**
   * The windows this subject can actually be measured over, read from the
   * subject's OWN calendar — an Indian mandate is offered fiscal quarters
   * (Q2 FY27), a US one calendar quarters. Fetched per subject rather than
   * once, because a household and a mandate in different books do not share a
   * period list.
   */
  useEffect(() => {
    if (!subject) return;
    let live = true;
    (async () => {
      try {
        const opts =
          subject.kind === 'family'
            ? await familyPerformanceApi.periods(subject.id)
            : await portfolioHistoryApi.periods(subject.id);
        if (!live) return;
        setOptions(opts);
        // Keep the chosen window across a change of subject when the new
        // subject also offers it: comparing two accounts over one quarter is
        // the common act, and resetting to the default would undo it every
        // time. Fall back to the first offered window when it does not.
        if (opts.length && !opts.some((o) => o.code === period)) setPeriod(opts[0].code);
      } catch {
        if (live) setOptions([]);
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  /**
   * The figures behind the preview — and, unchanged, the figures the PDF is
   * rendered from. The document is built from this exact payload rather than
   * refetched at download time, so what was previewed is what ships.
   */
  useEffect(() => {
    if (!isOpen || !subject) return;
    let live = true;

    (async () => {
      setLoading(true);
      setError(null);
      setNoBaseline(false);

      // A half-typed custom range is a keystroke, not a request — see
      // custom-range.ts. Hold the previous figures on screen until the pair is
      // complete rather than fetching the year 26 AD.
      if (period === 'CUSTOM' && !isUsableRange(customFrom, customTo)) {
        setResult(null);
        setAsOf(null);
        setLoading(false);
        return;
      }

      try {
        if (subject.kind === 'family') {
          const fr =
            period === 'CUSTOM'
              ? await familyPerformanceApi.customReturn(
                  subject.id,
                  new Date(customFrom),
                  new Date(customTo),
                )
              : await familyPerformanceApi.periodReturn(subject.id, period);
          if (!live) return;
          setResult(fr);
          // A household statement carries its member breakdown instead of a
          // position table; there is no single as-of portfolio to fetch.
          setAsOf(null);
        } else {
          const pr =
            period === 'CUSTOM'
              ? await portfolioHistoryApi.customReturn(
                  subject.id,
                  new Date(customFrom),
                  new Date(customTo),
                )
              : await portfolioHistoryApi.periodReturn(subject.id, period);
          // The closing composition, for the statement's holdings page. Its
          // absence is not fatal — the return, the flows and the benchmark are
          // fully determined without it — so a failure here still yields a
          // statement rather than none.
          const ao = await portfolioHistoryApi
            .asOf(subject.id, new Date(pr.to))
            .catch(() => null);
          if (!live) return;
          setResult(pr);
          setAsOf(ao);
        }
      } catch (e: any) {
        if (!live) return;
        setResult(null);
        setAsOf(null);
        if (e?.response?.status === 404) setNoBaseline(true);
        else setError(e?.response?.data?.message || 'Could not measure this period');
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
    };
  }, [isOpen, subject, period, customFrom, customTo]);

  const subjectName = useMemo(() => {
    if (!subject) return '';
    if (subject.kind === 'family') {
      return families.find((f) => f.id === subject.id)?.name ?? 'Household';
    }
    return clients?.find((c) => c.id === subject.id)?.name ?? 'Client';
  }, [subject, clients, families]);

  /**
   * The currency the document is denominated in, taken from the SUBJECT rather
   * than from the market toggle. The two normally agree, but the subject's own
   * record is the authority — a statement rendered under the wrong symbol is
   * wrong in the way that matters most.
   */
  const currency = useMemo(() => {
    if (!subject) return market === 'INDIA' ? 'INR' : 'USD';
    if (subject.kind === 'family') {
      return families.find((f) => f.id === subject.id)?.currency ?? (market === 'INDIA' ? 'INR' : 'USD');
    }
    return clients?.find((c) => c.id === subject.id)?.currency ?? (market === 'INDIA' ? 'INR' : 'USD');
  }, [subject, clients, families, market]);

  const money = useCallback(
    (n: number) =>
      n.toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 0,
      }),
    [currency],
  );

  const customInvalid = period === 'CUSTOM' ? rangeHint(customFrom, customTo) : null;

  /**
   * Generate stays disabled until there is a measured window behind it.
   *
   * A statement whose every figure reads "Not available" is not a lesser
   * report — it is a document that looks authoritative and says nothing, and it
   * is worse in a client's inbox than no document at all.
   */
  const canGenerate = !loading && !!result && result.returnPct !== null;

  const handleGenerate = async () => {
    if (!result) return;
    setGenerating(true);
    try {
      /**
       * The renderer is pulled in here rather than imported at the top,
       * because jsPDF and its autotable plugin together are a few hundred
       * kilobytes and the Reports page is opened far more often than a
       * statement is generated. Loading it on the click keeps that weight off
       * the page's first paint — and off the five other cards that share it.
       */
      const { downloadFamilyPerformancePdf, downloadPeriodPerformancePdf } = await import(
        '@/lib/performancePdf'
      );

      if (subject?.kind === 'family') {
        downloadFamilyPerformancePdf(result as FamilyPeriodReturn, currency);
      } else {
        downloadPeriodPerformancePdf(subjectName, result as PeriodReturn, asOf, currency);
      }
      toast({
        tone: 'success',
        title: 'Performance Summary generated',
        description: `${subjectName} · ${result.label} · PDF downloaded`,
      });
      onClose();
    } catch {
      toast({ tone: 'error', title: 'Could not build the statement' });
    } finally {
      setGenerating(false);
    }
  };

  const grouped = useMemo(() => {
    const groups: Record<string, PeriodOption[]> = {};
    for (const o of options) (groups[o.group] ??= []).push(o);
    return groups;
  }, [options]);

  const hasSubjects = (clients?.length ?? 0) > 0 || families.length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="xl"
      title="Performance Summary"
      description="Returns, attribution, and benchmark comparison — for one mandate or one household."
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] text-ink-tertiary">
            {result ? `${fmtDate(result.from)} → ${fmtDate(result.to)}` : 'Select a subject and period'}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              leftIcon={<Download className="h-4 w-4" />}
              disabled={!canGenerate}
              loading={generating}
              onClick={handleGenerate}
            >
              Generate PDF
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {clients === null ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !hasSubjects ? (
          <p className="text-[13px] text-ink-secondary">
            There are no clients or households in this book yet. Add a client and their
            performance statement can be generated here.
          </p>
        ) : (
          <>
            {/*
              One selector, two groups — the same control the Performance page
              uses. A household and a mandate are the same question asked at two
              levels, so choosing between them is a change of subject rather
              than a different kind of report. The value is prefixed by kind
              because both ids are opaque cuids and are otherwise
              indistinguishable.
            */}
            <Select
              label="Subject"
              helper="The mandate or household this statement is about."
              value={subject ? `${subject.kind}:${subject.id}` : ''}
              onChange={(e) => {
                const [kind, id] = e.target.value.split(':');
                if (kind === 'family' || kind === 'client') setSubject({ kind, id });
              }}
            >
              {families.length > 0 && (
                <optgroup label="Households">
                  {families.map((f) => (
                    <option key={f.id} value={`family:${f.id}`}>
                      {f.name} · {f.memberCount} {f.memberCount === 1 ? 'account' : 'accounts'}
                    </option>
                  ))}
                </optgroup>
              )}
              {clients && clients.length > 0 && (
                <optgroup label={families.length > 0 ? 'Individual accounts' : 'Accounts'}>
                  {clients.map((c) => (
                    <option key={c.id} value={`client:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>

            <Select
              label="Reporting period"
              helper="Read from this subject's own reporting calendar."
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              {options.length === 0 && <option value={period}>Loading periods…</option>}
              {Object.entries(grouped).map(([group, opts]) => (
                <optgroup key={group} label={group}>
                  {opts.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label} · {o.hint}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>

            {period === 'CUSTOM' && (
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="date"
                  label="From"
                  min={INCEPTION_ISO}
                  max={todayIso()}
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
                <Input
                  type="date"
                  label="To"
                  min={INCEPTION_ISO}
                  max={todayIso()}
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
                {customInvalid && (
                  <p className="col-span-2 -mt-1 text-[12px] text-ink-tertiary">{customInvalid}</p>
                )}
              </div>
            )}

            <Preview
              loading={loading}
              error={error}
              noBaseline={noBaseline}
              result={result}
              money={money}
              isFamily={subject?.kind === 'family'}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * What the document will say, before it is produced.
 *
 * Shows the headline return, the benchmark it is measured against and the
 * resulting alpha — plus, when the engine could not solve the window, the
 * reason in its own words rather than a dash. The reason is the useful half:
 * "fewer than two cash flows in this window" tells the reader to pick a
 * different period, where a blank tells them nothing.
 */
function Preview({
  loading,
  error,
  noBaseline,
  result,
  money,
  isFamily,
}: {
  loading: boolean;
  error: string | null;
  noBaseline: boolean;
  result: AnyReturn | null;
  money: (n: number) => string;
  isFamily: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-[10px] border border-border bg-surface-2 p-4">
        <Skeleton className="mb-3 h-4 w-24" />
        <Skeleton className="mb-2 h-8 w-32" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }

  if (noBaseline) {
    return (
      <Notice tone="warning">
        This subject has no Legacy Portfolio Baseline yet, so there is nothing to measure from.
        Seed a baseline on the Performance page, then generate the statement here.
      </Notice>
    );
  }

  if (error) return <Notice tone="danger">{error}</Notice>;

  if (!result) {
    return (
      <Notice tone="info">Choose a complete period to preview the statement.</Notice>
    );
  }

  const gain = result.closingValue - result.openingValue - result.netFlows;

  return (
    <div className="rounded-[10px] border border-border bg-surface-2">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
          Statement preview
        </span>
        <div className="flex items-center gap-2">
          {result.openPeriod && <Badge tone="info">Period still open</Badge>}
          {result.clampedToInception && result.daysClamped > 0 && (
            <Badge tone="warning">{result.daysClamped}d short</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
        <Metric
          label={isFamily ? 'Household return' : `Return · ${result.label}`}
          value={result.returnPct === null ? null : signedPct(result.returnPct)}
          reason={result.returnReason}
          emphasis
          positive={result.returnPct !== null && result.returnPct >= 0}
        />
        <Metric
          label={result.benchmark?.name ?? result.benchmark?.code ?? 'Benchmark'}
          value={
            result.benchmark?.xirr == null ? null : signedPct(result.benchmark.xirr)
          }
          reason={result.benchmark?.reason ?? 'No benchmark configured'}
        />
        <Metric
          label="Alpha"
          value={result.alpha === null ? null : signedPct(result.alpha)}
          positive={result.alpha !== null && result.alpha >= 0}
          reason="Needs both a portfolio and a benchmark return"
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-[12.5px]">
        <Row label="Opening value" value={money(result.openingValue)} />
        <Row label="Net flows" value={money(result.netFlows)} />
        <Row label="Closing value" value={money(result.closingValue)} emphasis />
        <Row label="Gain (net of flows)" value={money(gain)} emphasis />
      </dl>

      {/*
        Money-weighted is stated on the preview, not only in the file. The
        method is what makes the number comparable to the benchmark beside it,
        and a reader who checks the screen against the PDF should find the same
        claim on both.
      */}
      <p className="border-t border-border px-4 py-2.5 text-[11.5px] leading-relaxed text-ink-tertiary">
        {isFamily
          ? 'Measured as one account: a single money-weighted (XIRR) return solved over the combined flows of every member — not an average of the member returns.'
          : 'All figures are money-weighted (XIRR) over the selected window, as is the benchmark they are compared against.'}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  reason,
  emphasis,
  positive,
}: {
  label: string;
  value: string | null;
  reason?: string;
  emphasis?: boolean;
  positive?: boolean;
}) {
  return (
    <div className="px-4 py-3">
      <p className="truncate text-[10.5px] font-semibold uppercase tracking-wider text-ink-tertiary">
        {label}
      </p>
      {value === null ? (
        <>
          {/* Not a dash and not 0.00% — those read as "flat", which is a
              different and false claim from "could not be measured". */}
          <p className="mt-1 text-[13px] font-medium text-ink-tertiary">Not available</p>
          {reason && (
            <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-snug text-ink-tertiary">
              {reason}
            </p>
          )}
        </>
      ) : (
        <p
          className={cn(
            'mt-1 tabular-nums font-semibold',
            emphasis ? 'text-[22px] leading-tight' : 'text-[16px]',
            positive === undefined
              ? 'text-ink'
              : positive
                ? 'text-success'
                : 'text-danger',
          )}
        >
          {value}
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className={cn('tabular-nums', emphasis ? 'font-semibold text-ink' : 'text-ink')}>
        {value}
      </dd>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: 'info' | 'warning' | 'danger';
  children: React.ReactNode;
}) {
  const Icon = tone === 'info' ? Info : AlertTriangle;
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-[10px] border p-3.5 text-[12.5px] leading-relaxed',
        tone === 'info' && 'border-border bg-surface-2 text-ink-secondary',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-900',
        tone === 'danger' && 'border-red-200 bg-red-50 text-red-900',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
