'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Scale, Sprout, TrendingUp } from 'lucide-react';
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

/**
 * The Legacy Baseline / Reconstruction engine's view: MTD/QTD/YTD/custom
 * returns and "portfolio as of any date after the baseline". Deliberately a
 * separate panel from the existing since-inception XIRR sheet above it —
 * the two engines answer different questions and are not meant to
 * reconcile to the same number (see portfolio-history.api.ts).
 *
 * A client with no PortfolioBaseline yet gets a plain explanatory empty
 * state rather than a raw 404, since "no baseline" is the expected state for
 * any client that hasn't been onboarded onto this engine.
 */
export function HistoricalPanel({ clientId }: { clientId: string }) {
  const { toast } = useToast();
  // Every money figure on this panel is in the selected book's currency — an
  // Indian mandate's opening/closing values and per-position prices are rupees.
  const currency = useCurrency();

  /**
   * ONE control drives the whole tab. Selecting a period sets both the return
   * window and the date the holdings/allocation are shown as of — the period's
   * own end date, which the backend resolves (and clamps to today for a quarter
   * that has not closed). Two independent date controls could otherwise show a
   * Q2 return above a Q3 allocation table, which reads as a single coherent
   * report and is not one.
   */
  const [period, setPeriod] = useState<string>('INCEPTION');
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
      .then((p) => !cancelled && setOptions(p))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setNoBaseline(false);

      // A custom range needs its start before anything can be computed.
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

        // The holdings view follows the window the backend actually resolved,
        // so the allocation below is always as of the same date the return ends.
        const ao = await portfolioHistoryApi.asOf(clientId, new Date(pr.to));

        if (cancelled) return;
        setPeriodReturn(pr);
        setAsOf(ao);
      } catch (e: any) {
        if (cancelled) return;
        if (e?.response?.status === 404) {
          setNoBaseline(true);
        } else {
          setError(e?.response?.data?.message || 'Could not load historical data');
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

  if (loading) return <HistoricalSkeleton />;

  if (noBaseline) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-ink">
              No Legacy Portfolio Baseline set for this client
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
              Historical returns and as-of-date reports need an opening baseline
              (holdings + cash as of 30-June-2026, when Atlas started tracking
              transactions) before anything can be reconstructed. This client&apos;s
              current holdings can be used to build one automatically.
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
      <Card>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
          <p className="text-[13px] text-ink-secondary">{error}</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <CardHeader
              title="Historical Return"
              subtitle="Every window is based on the 30-June-2026 portfolio value and never opens before it"
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              aria-label="Period"
            >
              {options.length === 0 ? (
                <option value="INCEPTION">Since inception (30 Jun 2026)</option>
              ) : (
                options.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
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
        </div>

        {periodReturn ? (
          <>
            <p className="mt-3 text-[12px] text-ink-tertiary">
              {periodReturn.label} Â· {periodReturn.from.slice(0, 10)} â†’ {periodReturn.to.slice(0, 10)}
              {periodReturn.openPeriod && ' Â· period still open, measured to today'}
              {periodReturn.clampedToInception && ' Â· start pulled forward to inception'}
            </p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile
                label={`Opening value (${periodReturn.from.slice(0, 10)})`}
                value={formatCurrency(periodReturn.openingValue, currency)}
              />
              <StatTile label="Closing value" value={formatCurrency(periodReturn.closingValue, currency)} />
              <StatTile
                label={`${periodReturn.label} return`}
                value={periodReturn.returnPct !== null ? signedPct(periodReturn.returnPct) : 'Not available'}
                tone={
                  periodReturn.returnPct === null
                    ? 'neutral'
                    : periodReturn.returnPct >= 0
                      ? 'pos'
                      : 'neg'
                }
                icon={<TrendingUp className="h-4 w-4" />}
              />
              <StatTile
                label={periodReturn.benchmark ? `vs ${periodReturn.benchmark.code}` : 'Benchmark'}
                value={
                  periodReturn.benchmark?.interim != null
                    ? signedPct(periodReturn.benchmark.interim)
                    : periodReturn.benchmark
                      ? 'Not available'
                      : 'No benchmark set'
                }
                tone={
                  periodReturn.benchmark?.interim == null
                    ? 'neutral'
                    : periodReturn.benchmark.interim >= 0
                      ? 'pos'
                      : 'neg'
                }
                icon={<Scale className="h-4 w-4" />}
              />
            </div>
            {periodReturn.benchmark?.interim != null && periodReturn.returnPct !== null && (
              <p className="mt-3 text-[12px] leading-relaxed text-ink-tertiary">
                Alpha ({periodReturn.label}):{' '}
                <span
                  className={cn(
                    'font-semibold',
                    periodReturn.returnPct - periodReturn.benchmark.interim >= 0
                      ? 'text-emerald-600'
                      : 'text-rose-600',
                  )}
                >
                  {signedPct(periodReturn.returnPct - periodReturn.benchmark.interim)}
                </span>{' '}
                vs {periodReturn.benchmark.name}, same window, unit-purchase method (same
                construction as the Current tab&apos;s Alpha card).
              </p>
            )}
            {periodReturn.benchmark?.reason && (
              <p className="mt-3 text-[12px] leading-relaxed text-amber-600">
                {periodReturn.benchmark.reason}
              </p>
            )}
          </>
        ) : period === 'CUSTOM' && !customFrom ? (
          <p className="mt-4 text-[13px] text-ink-tertiary">
            Choose a &quot;From&quot; date to compute a custom-range return.
          </p>
        ) : null}
      </Card>

      {asOf && (
        <>
          <Card>
            <CardHeader
              title={`Portfolio as of ${asOf.asOfDate.slice(0, 10)}`}
              subtitle={
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Baseline {new Date(asOf.baselineDate).toLocaleDateString()}
                  <Badge tone={asOf.source === 'snapshot' ? 'success' : 'neutral'}>
                    {asOf.source === 'snapshot' ? 'from daily snapshot' : 'reconstructed'}
                  </Badge>
                </span>
              }
            />
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Portfolio value" value={formatCurrency(asOf.portfolioValue, currency)} />
              <StatTile label="Cash" value={formatCurrency(asOf.cash, currency)} />
              <StatTile
                label="Unrealized gain"
                value={formatSignedCurrency(asOf.unrealizedGain, currency)}
                tone={asOf.unrealizedGain >= 0 ? 'pos' : 'neg'}
              />
              <StatTile
                label="Realized gain (since baseline)"
                value={formatSignedCurrency(asOf.realizedGain, currency)}
                tone={asOf.realizedGain >= 0 ? 'pos' : 'neg'}
              />
            </div>
            {asOf.cashShortfall > 0 && (
              <p className="mt-3 text-[12px] leading-relaxed text-amber-600">
                Cash is shown as zero: replaying the ledger to this date left it{' '}
                {formatCurrency(asOf.cashShortfall, currency)} below zero, which means some proceeds are
                recorded without their matching purchase. Allocation weights are computed on the
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
            <CardHeader title="Holdings" subtitle={`${asOf.positions.length} positions on this date`} />
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

function StatTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg' | 'neutral';
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">{label}</p>
        {icon && <span className="text-ink-tertiary">{icon}</span>}
      </div>
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
    </div>
  );
}

function AllocationCard({
  title,
  allocation,
}: {
  title: string;
  allocation: { slices: Array<{ key: string; value: number; weight: number }>; unclassifiedWeight: number };
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

function HistoricalSkeleton() {
  return (
    <div className="space-y-6">
      <div className="card p-5">
        <Skeleton className="h-5 w-40" />
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
