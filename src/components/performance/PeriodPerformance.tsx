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
import { useCurrency } from '@/components/layout/MarketContext';
import { Badge, Button, Card, CardHeader, Input, Select, Skeleton, useToast } from '@/components/ui';

const signedPct = (v: number, dp = 2) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;
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
 * Every figure on this page is money-weighted (XIRR) and every figure is for the
 * SELECTED window — including the benchmark and the alpha. That uniformity is
 * the point: a reader never has to ask what basis a number is on.
 */
export function PeriodPerformance({ clientId }: { clientId: string }) {
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
  const [customTo, setCustomTo] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const [periodReturn, setPeriodReturn] = useState<PeriodReturn | null>(null);
  const [asOf, setAsOf] = useState<PortfolioAsOf | null>(null);
  const [loading, setLoading] = useState(true);
  const [noBaseline, setNoBaseline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

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

      if (period === 'CUSTOM' && !customFrom) {
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
              )
            : await portfolioHistoryApi.periodReturn(clientId, period);

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
  }, [clientId, period, customFrom, customTo, reloadTick]);

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
      {period === 'CUSTOM' && (
        <>
          <Input
            type="date"
            label="From"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
          />
          <Input
            type="date"
            label="To"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
          />
        </>
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

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Headline
                label={`${periodReturn.label} return`}
                value={periodReturn.returnPct}
                unavailable={periodReturn.returnReason}
                hint="Money-weighted (XIRR), flow-adjusted"
              />
              <StatTile
                label={periodReturn.benchmark ? `${periodReturn.benchmark.code} return` : 'Benchmark'}
                value={
                  periodReturn.benchmark?.interim != null
                    ? signedPct(periodReturn.benchmark.interim)
                    : periodReturn.benchmark
                      ? 'Not available'
                      : 'None set'
                }
                tone={
                  periodReturn.benchmark?.interim == null
                    ? 'neutral'
                    : periodReturn.benchmark.interim >= 0
                      ? 'pos'
                      : 'neg'
                }
                hint={periodReturn.benchmark ? 'Same window, same flows' : undefined}
              />
              <StatTile
                label="Alpha"
                value={periodReturn.alpha !== null ? signedPct(periodReturn.alpha) : 'Not available'}
                tone={
                  periodReturn.alpha === null ? 'neutral' : periodReturn.alpha >= 0 ? 'pos' : 'neg'
                }
                hint={
                  periodReturn.alpha !== null
                    ? 'Portfolio − benchmark'
                    : 'Needs a benchmark and a solved return'
                }
              />
              <StatTile
                label="Gain"
                value={formatSignedCurrency(
                  periodReturn.closingValue - periodReturn.openingValue - periodReturn.netFlows,
                  currency,
                )}
                tone={
                  periodReturn.closingValue - periodReturn.openingValue - periodReturn.netFlows >= 0
                    ? 'pos'
                    : 'neg'
                }
                hint="Value change, net of deposits"
              />
            </div>

            {periodReturn.benchmark?.reason && (
              <p className="mt-3 text-[12px] leading-relaxed text-amber-600">
                {periodReturn.benchmark.reason}
              </p>
            )}
          </>
        ) : period === 'CUSTOM' && !customFrom ? (
          <p className="mt-4 text-[13px] text-ink-tertiary">
            Choose a &quot;From&quot; date to measure a custom range.
          </p>
        ) : null}
      </Card>

      {/* ── 2. How the headline was built. The audit trail. ─────────────── */}
      {periodReturn && <Reconciliation r={periodReturn} />}

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
                {formatCurrency(asOf.cashShortfall, currency)} below zero, which means some proceeds
                are recorded without their matching purchase. Allocation weights are computed on the
                floored balance, so they stay correct — but the ledger gap is worth closing.
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
      `${r.label} would open on ${fmtDate(r.nominalFrom)}, but the book has no priced history before ` +
        `30 Jun 2026 — so this measures from then, ${r.daysClamped} days short of the full window.`,
    );
  }
  if (r.openPeriod) {
    notes.push('This period is still open — measured to today, not to its close.');
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

/**
 * The working behind the headline: opening value, what money moved, closing
 * value, and the two return figures side by side.
 *
 * The simple return is here rather than on the headline row deliberately. It
 * ties to a custody statement, so operators do ask for it — but it counts a
 * deposit as performance, and on a book that took a large mid-window
 * contribution it is the flattering number. Showing both, adjacent and
 * labelled, is what stops the flattering one being quoted by accident.
 */
function Reconciliation({ r }: { r: PeriodReturn }) {
  const currency = useCurrency();
  const gap =
    r.returnPct !== null && r.simpleReturnPct !== null ? r.simpleReturnPct - r.returnPct : null;

  return (
    <Card>
      <CardHeader
        title="How this was calculated"
        subtitle="Every figure above is money-weighted over the selected window"
      />
      <div className="mt-4 divide-y divide-border">
        <Row label={`Opening value (${fmtDate(r.from)})`} value={formatCurrency(r.openingValue, currency)} />
        <Row
          label="Deposits − withdrawals during the period"
          value={formatSignedCurrency(r.netFlows, currency)}
        />
        <Row label={`Closing value (${fmtDate(r.to)})`} value={formatCurrency(r.closingValue, currency)} />
        <Row
          label="Money-weighted return (XIRR)"
          value={r.returnPct !== null ? signedPct(r.returnPct) : 'Not available'}
          tone={r.returnPct === null ? undefined : r.returnPct >= 0 ? 'pos' : 'neg'}
          emphasis
        />
        <Row
          label="Annualized"
          value={
            r.annualizedReturnPct !== null
              ? signedPct(r.annualizedReturnPct)
              : 'Window too short to annualize'
          }
          tone={
            r.annualizedReturnPct === null ? undefined : r.annualizedReturnPct >= 0 ? 'pos' : 'neg'
          }
          muted={r.annualizedReturnPct === null}
        />
        <Row
          label="Simple return (closing ÷ opening)"
          value={r.simpleReturnPct !== null ? signedPct(r.simpleReturnPct) : '—'}
          muted
        />
      </div>

      {/* Only worth saying when the two actually diverge — below a basis point
          the distinction is noise and the note would be clutter. */}
      {gap !== null && Math.abs(gap) > 0.0001 && (
        <p className="mt-4 rounded-lg bg-surface-2 p-3 text-[12px] leading-relaxed text-ink-secondary">
          The simple return reads {signedPct(gap)} higher than the money-weighted one because it
          treats the {formatSignedCurrency(r.netFlows, currency)} of net deposits in this window as
          performance. The money-weighted figure above does not, which is why it is the one reported.
        </p>
      )}
    </Card>
  );
}

/** The one number the page exists to show. Sized and placed to be read first. */
function Headline({
  label,
  value,
  hint,
  unavailable,
}: {
  label: string;
  value: number | null;
  hint?: string;
  unavailable?: string;
}) {
  if (value === null) {
    return (
      <div className="rounded-xl border-2 border-border p-4">
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{label}</p>
        <p className="mt-2 text-[18px] font-semibold text-ink-tertiary">Not available</p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-tertiary">
          {unavailable ?? 'The return could not be solved for this window.'}
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-xl border-2 p-4',
        value >= 0 ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40',
      )}
    >
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{label}</p>
      <p
        className={cn(
          'mt-2 text-[30px] font-semibold tabular-nums tracking-tight',
          value >= 0 ? 'text-emerald-600' : 'text-rose-600',
        )}
      >
        {signedPct(value)}
      </p>
      {hint && <p className="mt-1 text-[12px] text-ink-tertiary">{hint}</p>}
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

function Row({
  label,
  value,
  tone,
  emphasis,
  muted,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg';
  emphasis?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span
        className={cn(
          'text-[13px]',
          emphasis ? 'font-semibold text-ink' : 'text-ink-secondary',
          muted && 'text-ink-tertiary',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'text-[13px] tabular-nums',
          emphasis && 'text-[15px] font-semibold',
          muted && 'text-ink-tertiary',
          !muted && tone === 'pos' && 'text-emerald-600',
          !muted && tone === 'neg' && 'text-rose-600',
          !muted && !tone && 'text-ink-secondary',
        )}
      >
        {value}
      </span>
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
