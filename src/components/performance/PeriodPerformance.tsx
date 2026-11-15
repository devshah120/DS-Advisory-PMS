'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Info, Sprout } from 'lucide-react';
import {
  portfolioHistoryApi,
  PortfolioAsOf,
  PeriodReturn,
  PeriodOption,
} from '@/lib/portfolio-history.api';
import { formatCurrency, formatSignedCurrency, cn } from '@/lib/utils';
import { useCurrency, useMarket } from '@/components/layout/MarketContext';
import { MARKET_BENCHMARKS } from '@/lib/market-scope';
import { clientsApi } from '@/lib/clients.api';
import { Badge, Button, Card, CardHeader, Input, Select, Skeleton, useToast } from '@/components/ui';
import {
  CapitalReconciliation,
  ReturnHeadline,
  returnBasis,
  signedPct,
} from '@/components/performance/ReturnBasis';
import {
  DEFAULT_INCEPTION_ISO,
  isUsableRange,
  rangeHint,
  todayIso,
} from '@/lib/custom-range';

const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * The Performance sheet — ONE view, one period selector, one headline.
 *
 * This replaces a two-tab layout ("Current (since inception)" / "Historical (as
 * of a date)") that split one question across two engines. The split was the
 * source of the confusion it is worth naming, because the fix is structural
 * rather than cosmetic:
 *
 *   - Two tabs each reported a "return" computed a different way, so the same
 *     book showed two different numbers with nothing saying which to believe.
 *   - The since-inception tab's headline was labelled "Alpha (QTD)" but was not
 *     QTD at all — it was the since-inception spread, de-annualized.
 *   - Fourteen KPI tiles arrived in no order of importance, so finding the one
 *     number a review meeting opens on meant reading all of them.
 *
 * Now: pick a window, get ONE headline return for it, with everything else
 * arranged underneath in descending order of how often it is asked for. Since
 * inception is just another entry in the same dropdown, because it is just
 * another window.
 *
 * Every figure on this page is money-weighted and for the SELECTED window —
 * including the benchmark and the alpha. Sub-year windows lead with the period
 * MWRR, a year or more with XIRR p.a. (see ReturnBasis), and the benchmark and
 * alpha always follow the headline's basis.
 */
/**
 * What the page above needs to know to drive its own header buttons.
 *
 * The period, and therefore the data, is chosen INSIDE this component — the
 * selector belongs beside the figures it labels, not up in the header where it
 * would sit detached from them. But Export has to ship whatever window is
 * currently on screen, and it lives in the page header alongside the client
 * selector. Reporting the loaded window upward is what lets those two facts
 * coexist without lifting the period control out of the sheet.
 */
export interface PeriodSheetState {
  periodReturn: PeriodReturn | null;
  asOf: PortfolioAsOf | null;
  loading: boolean;
}

export function PeriodPerformance({
  clientId,
  /**
   * Bumped by the page's Refresh button. A counter rather than a callback ref
   * because it re-triggers the existing load effect through the same
   * `reloadTick` path the seed flow already uses — no second fetch path to keep
   * in step with the first.
   */
  refreshSignal = 0,
  onStateChange,
}: {
  clientId: string;
  refreshSignal?: number;
  onStateChange?: (state: PeriodSheetState) => void;
}) {
  const { toast } = useToast();
  const currency = useCurrency();

  /**
   * ONE control drives the whole page. The period sets both the return window
   * and the date holdings/allocation are shown as of — the window's own end
   * date. Two independent controls could otherwise show a Q2 return above a Q3
   * allocation table, which reads as one coherent report and is not one.
   */
  const [period, setPeriod] = useState<string>('QTD');
  const [options, setOptions] = useState<PeriodOption[]>([]);
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>(todayIso);

  const [periodReturn, setPeriodReturn] = useState<PeriodReturn | null>(null);
  const [asOf, setAsOf] = useState<PortfolioAsOf | null>(null);
  const [loading, setLoading] = useState(true);
  const [noBaseline, setNoBaseline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  /**
   * Which index to measure against. Null = the client's own benchmark. Keyed by
   * client so switching client drops the comparison in the same render, rather
   * than first fetching the new client against the previous one's choice.
   */
  const { market } = useMarket();
  const benchmarkOptions = MARKET_BENCHMARKS[market];
  const [compare, setCompare] = useState<{ clientId: string; code: string } | null>(null);
  const compareCode = compare?.clientId === clientId ? compare.code : null;
  const [savingDefault, setSavingDefault] = useState(false);
  const assignedCode = periodReturn?.assignedBenchmarkCode ?? null;
  const benchmarkLabel = (code: string | null | undefined) =>
    benchmarkOptions.find((b) => b.code === code)?.label ?? code ?? 'Benchmark';

  /**
   * The floor for the date picker: this client's own inception, as reported by
   * the periods endpoint. Falls back to the house date only until the options
   * have loaded — every option carries the same value, so the first one does.
   */
  const inceptionIso = options[0]?.inceptionIso ?? DEFAULT_INCEPTION_ISO;

  useEffect(() => {
    let cancelled = false;
    portfolioHistoryApi
      .periods(clientId)
      .then((p) => {
        if (cancelled) return;
        setOptions(p);
        // Default to the first offered window — the current quarter — rather
        // than to inception. A review opens on "how are we doing this quarter".
        if (p.length && !p.some((o) => o.code === period)) setPeriod(p[0].code);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setNoBaseline(false);

      /**
       * Hold off while a custom range is still being typed.
       *
       * A native date input fires on every keystroke, so typing the year 2026
       * passes through 0002 / 0020 / 0202 first. Fetching those asks the engine
       * to measure from the year 26 AD, which it answers — correctly, and
       * bafflingly — with a "36510 days short of the full window" warning while
       * the user is still mid-keystroke. Waiting for a complete, in-range pair
       * keeps the loaded window on screen until there is a real range to load.
       */
      if (period === 'CUSTOM' && !isUsableRange(customFrom, customTo, inceptionIso)) {
        setPeriodReturn(null);
        setAsOf(null);
        setLoading(false);
        return;
      }

      try {
        const pr =
          period === 'CUSTOM'
            ? await portfolioHistoryApi.customReturn(
                clientId,
                new Date(customFrom),
                new Date(customTo),
                compareCode ?? undefined,
              )
            : await portfolioHistoryApi.periodReturn(clientId, period, compareCode ?? undefined);

        const ao = await portfolioHistoryApi.asOf(clientId, new Date(pr.to));

        if (cancelled) return;
        setPeriodReturn(pr);
        setAsOf(ao);
      } catch (e: any) {
        if (cancelled) return;
        if (e?.response?.status === 404) {
          setNoBaseline(true);
        } else {
          setError(e?.response?.data?.message || 'Could not load performance for this period');
        }
        setPeriodReturn(null);
        setAsOf(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [clientId, period, customFrom, customTo, compareCode, reloadTick, refreshSignal]);

  /**
   * Mirror the sheet's state up to the page so its header Export button knows
   * whether there is a window to ship and, when there is, which one.
   *
   * Reported from an effect rather than from inside `load` so it also covers
   * the failure paths, where the page must be told the data went away — an
   * Export button left enabled after a failed reload would download the
   * previous period's figures under the newly selected period's name.
   */
  useEffect(() => {
    onStateChange?.({ periodReturn, asOf, loading });
    // `onStateChange` is intentionally not a dependency: the page passes an
    // inline callback, so including it would fire this on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodReturn, asOf, loading]);

  async function seedBaselines() {
    setSeeding(true);
    try {
      const summary = await portfolioHistoryApi.autoSeedBaselines();
      toast({
        tone: summary.failed.length ? 'error' : 'success',
        title: `Baselines: ${summary.created.length} created, ${summary.skipped.length} already existed${
          summary.failed.length ? `, ${summary.failed.length} failed` : ''
        }`,
      });
      setReloadTick((t) => t + 1);
    } catch {
      toast({ tone: 'error', title: 'Could not seed baselines' });
    } finally {
      setSeeding(false);
    }
  }

  /**
   * Saves the benchmark being compared against as the client's own, so every
   * later view, export and review pack uses it without re-selecting.
   */
  async function makeDefault(code: string) {
    setSavingDefault(true);
    try {
      await clientsApi.update(clientId, { benchmark: code });
      toast({ tone: 'success', title: `${benchmarkLabel(code)} is now this client's benchmark` });
      setCompare(null);
      setReloadTick((t) => t + 1);
    } catch (e: any) {
      const msg =
        e?.response?.data?.errors?.benchmark ?? e?.response?.data?.message ?? 'Could not save';
      toast({ tone: 'error', title: typeof msg === 'string' ? msg : 'Could not save' });
    } finally {
      setSavingDefault(false);
    }
  }

  /** Options grouped into optgroups, preserving the backend's ordering. */
  const grouped = useMemo(() => {
    const out: Array<{ group: string; items: PeriodOption[] }> = [];
    for (const o of options) {
      const last = out[out.length - 1];
      if (last && last.group === o.group) last.items.push(o);
      else out.push({ group: o.group, items: [o] });
    }
    return out;
  }, [options]);

  /** Why the range is not measurable yet, or null once it is. */
  const customHint =
    period === 'CUSTOM' ? rangeHint(customFrom, customTo, inceptionIso) : null;

  const selector = (
    <div className="flex flex-wrap items-end gap-3">
      <Select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period">
        {grouped.length === 0 ? (
          <option value="QTD">Quarter to date</option>
        ) : (
          grouped.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.items.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))
        )}
      </Select>
      <Select
        aria-label="Compare against"
        value={compareCode ?? assignedCode ?? ''}
        onChange={(e) => {
          const code = e.target.value;
          setCompare(!code || code === assignedCode ? null : { clientId, code });
        }}
      >
        {!assignedCode && !compareCode && <option value="">Client&apos;s benchmark</option>}
        {benchmarkOptions.map((b) => (
          <option key={b.code} value={b.code}>
            vs {b.label}
            {b.code === assignedCode ? ' (client default)' : ''}
          </option>
        ))}
      </Select>
      {period === 'CUSTOM' && (
        <>
          {/* min/max bound BOTH the typed year and the calendar picker, so the
              year 0026 that a half-typed "2026" produces is rejected by the
              browser itself rather than sent to the engine and reported back as
              a 36,510-day shortfall. */}
          <Input
            type="date"
            label="From"
            value={customFrom}
            min={inceptionIso}
            max={customTo || todayIso()}
            onChange={(e) => setCustomFrom(e.target.value)}
          />
          <Input
            type="date"
            label="To"
            value={customTo}
            min={customFrom || inceptionIso}
            max={todayIso()}
            onChange={(e) => setCustomTo(e.target.value)}
          />
        </>
      )}
      {/* Says "keep typing", not "error" — the range is incomplete, not wrong. */}
      {period === 'CUSTOM' && customHint && (
        <p className="w-full text-[12px] leading-relaxed text-ink-tertiary">{customHint}</p>
      )}
    </div>
  );

  if (loading) return <PerformanceSkeleton selector={selector} />;

  if (noBaseline) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-ink">
              No opening baseline set for this client
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
              Period returns need an opening portfolio value (holdings + cash as of
              30-June-2026, when tracking started) before anything can be measured. This
              client&apos;s current holdings can be used to build one automatically.
            </p>
            <Button
              className="mt-3"
              variant="outline"
              size="sm"
              leftIcon={<Sprout className="h-4 w-4" />}
              disabled={seeding}
              onClick={seedBaselines}
            >
              {seeding ? 'Seeding…' : 'Seed baselines from Holdings'}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Card>{selector}</Card>
        <Card>
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
            <p className="text-[13px] text-ink-secondary">{error}</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── 1. The headline. One number, its window, its caveats. ───────── */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <CardHeader
              title={periodReturn ? periodReturn.label : 'Performance'}
              subtitle={
                periodReturn
                  ? `${fmtDate(periodReturn.from)} → ${fmtDate(periodReturn.to)} · ${periodReturn.periodDays} days`
                  : 'Select a period'
              }
            />
          </div>
          {selector}
        </div>

        {periodReturn ? (
          <>
            <WindowNotes r={periodReturn} />

            <HeadlineRow r={periodReturn} benchmarkLabel={benchmarkLabel} />

            {periodReturn.benchmark?.reason && (
              <p className="mt-3 text-[12px] leading-relaxed text-amber-600">
                {periodReturn.benchmark.reason}
              </p>
            )}

            {/* A comparison is a what-if until saved — say so beside the figures,
                so a screenshot of it is never mistaken for the mandate's own. */}
            {compareCode && compareCode !== assignedCode && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 p-3">
                <p className="text-[12px] leading-relaxed text-ink-secondary">
                  Comparing against <span className="font-semibold text-ink">{benchmarkLabel(compareCode)}</span>{' '}
                  for this view only. This client&apos;s benchmark is{' '}
                  {benchmarkLabel(assignedCode)}.
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setCompare(null)}>
                    Reset
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={savingDefault}
                    onClick={() => makeDefault(compareCode)}
                  >
                    {savingDefault ? 'Saving…' : `Make ${benchmarkLabel(compareCode)} the default`}
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : customHint ? (
          // Covers every not-yet-measurable state, not just an empty From: a
          // half-typed year lands here too, so the card explains itself instead
          // of going blank.
          <p className="mt-4 text-[13px] text-ink-tertiary">{customHint}</p>
        ) : null}
      </Card>

      {/* ── 2. How the headline was built. The audit trail. ─────────────── */}
      {periodReturn && (
        <CapitalReconciliation
          r={periodReturn}
          currency={currency}
          benchmarkLabel={
            periodReturn.benchmark ? benchmarkLabel(periodReturn.benchmark.code) : null
          }
        />
      )}

      {/* ── 3. The book on the window's end date. ───────────────────────── */}
      {asOf && (
        <>
          <Card>
            <CardHeader
              title={`Portfolio on ${fmtDate(asOf.asOfDate)}`}
              subtitle={
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" />
                  The closing date of the selected period
                  <Badge tone={asOf.source === 'snapshot' ? 'success' : 'neutral'}>
                    {asOf.source === 'snapshot' ? 'from daily snapshot' : 'reconstructed'}
                  </Badge>
                </span>
              }
            />
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Portfolio value" value={formatCurrency(asOf.portfolioValue, currency)} />
              <StatTile
                label="Holdings"
                value={formatCurrency(asOf.holdingsValue, currency)}
                hint={
                  asOf.portfolioValue > 0
                    ? `${pct(asOf.holdingsValue / asOf.portfolioValue)} of the book`
                    : undefined
                }
              />
              <StatTile
                label="Cash"
                value={formatCurrency(asOf.cash, currency)}
                hint={
                  asOf.portfolioValue > 0
                    ? `${pct(asOf.cash / asOf.portfolioValue)} of the book`
                    : undefined
                }
              />
              <StatTile
                label="Unrealized gain"
                value={formatSignedCurrency(asOf.unrealizedGain, currency)}
                tone={asOf.unrealizedGain >= 0 ? 'pos' : 'neg'}
              />
            </div>
            {asOf.cashShortfall > 0 && (
              <p className="mt-3 text-[12px] leading-relaxed text-amber-600">
                Cash is shown as zero: replaying the ledger to this date left it{' '}
                {formatCurrency(asOf.cashShortfall, currency)} below zero. The replay starts from the
                account&rsquo;s opening balance and applies every trade, so a shortfall means it never
                saw the money these purchases were funded with — most often an opening balance or
                deposits that were never recorded, or a trade entered twice. Position values and
                allocation weights are unaffected; the cash line is what cannot be trusted until the
                gap is closed.
              </p>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <AllocationCard title="Sector Allocation" allocation={asOf.sectorAllocation} />
            <AllocationCard title="Country Allocation" allocation={asOf.countryAllocation} />
            <AllocationCard title="Asset Allocation" allocation={asOf.assetAllocation} />
          </div>

          <Card>
            <CardHeader
              title="Holdings"
              subtitle={`${asOf.positions.length} positions on ${fmtDate(asOf.asOfDate)}`}
            />
            {asOf.positions.length === 0 ? (
              <p className="mt-3 text-[13px] text-ink-tertiary">No open positions on this date.</p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left text-ink-tertiary">
                      <th className="pb-2 font-medium">Ticker</th>
                      <th className="pb-2 text-right font-medium">Qty</th>
                      <th className="pb-2 text-right font-medium">Avg Cost</th>
                      <th className="pb-2 text-right font-medium">Close</th>
                      <th className="pb-2 text-right font-medium">Market Value</th>
                      <th className="pb-2 text-right font-medium">Weight</th>
                      <th className="pb-2 text-right font-medium">Unrealized</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {asOf.positions.map((p) => (
                      <tr key={p.ticker}>
                        <td className="py-2.5 font-semibold text-ink">{p.ticker}</td>
                        <td className="py-2.5 text-right tabular-nums text-ink-secondary">
                          {p.quantity.toLocaleString()}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-ink-secondary">
                          {formatCurrency(p.averageCost, currency)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-ink-secondary">
                          {formatCurrency(p.closingPrice, currency)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-ink-secondary">
                          {formatCurrency(p.marketValue, currency)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-ink-secondary">
                          {pct(p.weight)}
                        </td>
                        <td
                          className={cn(
                            'py-2.5 text-right font-semibold tabular-nums',
                            p.unrealizedGain >= 0 ? 'text-emerald-600' : 'text-rose-600',
                          )}
                        >
                          {formatSignedCurrency(p.unrealizedGain, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * The caveats that qualify the headline, stated where the headline is.
 *
 * A clamped window is publishable; a clamped window wearing an unqualified
 * label is not. "FYTD" over a figure that actually measures from 30-June is
 * exactly the kind of number that gets screenshotted and then defended in a
 * meeting, so the shortfall is said in plain words rather than encoded in a
 * badge nobody decodes.
 */
function WindowNotes({ r }: { r: PeriodReturn }) {
  const notes: string[] = [];

  if (r.daysClamped > 0 && r.nominalFrom) {
    notes.push(
      `Measured from inception (30 Jun 2026); ${r.label} nominally opens ${fmtDate(r.nominalFrom)} — ` +
        `${r.daysClamped} days excluded.`,
    );
  }
  if (r.openPeriod) {
    notes.push(`Period open — measured to ${fmtDate(r.to)}.`);
  }

  if (!notes.length) return null;

  return (
    <div className="mt-4 space-y-2">
      {notes.map((n) => (
        <div
          key={n}
          className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3"
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-[12px] leading-relaxed text-amber-900">{n}</p>
        </div>
      ))}
    </div>
  );
}

/** Headline return, benchmark, alpha and net gain — all on the window's reporting basis. */
function HeadlineRow({
  r,
  benchmarkLabel,
}: {
  r: PeriodReturn;
  benchmarkLabel: (code: string | null | undefined) => string;
}) {
  const currency = useCurrency();
  const basis = returnBasis(r);
  const gain = r.closingValue - r.openingValue - r.netFlows;
  const tone = (v: number | null) => (v === null ? 'neutral' : v >= 0 ? 'pos' : 'neg');

  return (
    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <ReturnHeadline r={r} unavailable={r.returnReason} />
      <StatTile
        label={r.benchmark ? `${benchmarkLabel(r.benchmark.code)} return` : 'Benchmark'}
        value={
          basis.benchmark !== null
            ? `${signedPct(basis.benchmark)}${basis.suffix}`
            : r.benchmark
              ? 'Not available'
              : 'None set'
        }
        tone={tone(basis.benchmark)}
        hint={r.benchmark ? 'Cash-flow matched' : undefined}
      />
      <StatTile
        label="Alpha"
        value={basis.alpha !== null ? `${signedPct(basis.alpha)}${basis.suffix}` : 'Not available'}
        tone={tone(basis.alpha)}
        hint={basis.alpha !== null ? 'Excess return over benchmark' : undefined}
      />
      <StatTile
        label="Net gain"
        value={formatSignedCurrency(gain, currency)}
        tone={tone(gain)}
        hint="Net of capital flows"
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg' | 'neutral';
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{label}</p>
      <p
        className={cn(
          'mt-2 text-[20px] font-semibold tabular-nums tracking-tight',
          tone === 'pos' && 'text-emerald-600',
          tone === 'neg' && 'text-rose-600',
          (!tone || tone === 'neutral') && 'text-ink',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-[12px] text-ink-tertiary">{hint}</p>}
    </div>
  );
}

function AllocationCard({
  title,
  allocation,
}: {
  title: string;
  allocation: {
    slices: Array<{ key: string; value: number; weight: number }>;
    unclassifiedWeight: number;
  };
}) {
  return (
    <Card>
      <CardHeader title={title} />
      <div className="mt-4 space-y-2.5">
        {allocation.slices.length === 0 ? (
          <p className="text-[13px] text-ink-tertiary">No data.</p>
        ) : (
          allocation.slices.slice(0, 8).map((s) => (
            <div key={s.key} className="flex items-center gap-3">
              <span className="w-24 shrink-0 truncate text-[13px] font-medium text-ink">{s.key}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.min(100, s.weight * 100)}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink-secondary">
                {pct(s.weight)}
              </span>
            </div>
          ))
        )}
        {allocation.unclassifiedWeight > 0 && (
          <p className="pt-1 text-[12px] text-amber-600">
            {pct(allocation.unclassifiedWeight)} unclassified.
          </p>
        )}
      </div>
    </Card>
  );
}

function PerformanceSkeleton({ selector }: { selector: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Skeleton className="h-9 w-48" />
          {selector}
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
      <div className="card p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
    </div>
  );
}
