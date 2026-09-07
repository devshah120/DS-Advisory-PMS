'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Users } from 'lucide-react';
import {
  familyPerformanceApi,
  FamilyPeriodReturn,
} from '@/lib/family-performance.api';
import { PeriodOption } from '@/lib/portfolio-history.api';
import { formatCurrency, formatSignedCurrency, cn } from '@/lib/utils';
import { useCurrency } from '@/components/layout/MarketContext';
import { Badge, Card, CardHeader, Input, Select, Skeleton } from '@/components/ui';

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
 * What the page above needs to drive its own header buttons — the same
 * contract the single-client sheet reports, so the header does not have to
 * know which of the two is mounted.
 */
export interface FamilySheetState {
  periodReturn: FamilyPeriodReturn | null;
  loading: boolean;
}

/**
 * The Performance sheet for a HOUSEHOLD.
 *
 * Deliberately the same shape as the single-client sheet — same period
 * selector, same headline row, same reconciliation table — because it answers
 * the same question about a different subject. A reader who has learned to
 * read one has learned to read the other, and the numbers are directly
 * comparable because they come from the same engine.
 *
 * The one thing this sheet adds is the member breakdown: the household figure
 * answers "how is this family doing", and the table answers the question that
 * always follows it, "which account moved it".
 *
 * A note the sheet itself makes, because it is the most likely
 * misreading: the member returns do NOT average to the household return, and
 * are not supposed to. The household is one XIRR over the family's combined
 * flows. The column that does reconcile is Gain, which sums exactly.
 */
export function FamilyPerformance({
  familyId,
  refreshSignal = 0,
  onStateChange,
}: {
  familyId: string;
  refreshSignal?: number;
  onStateChange?: (state: FamilySheetState) => void;
}) {
  const currency = useCurrency();

  const [period, setPeriod] = useState<string>('QTD');
  const [options, setOptions] = useState<PeriodOption[]>([]);
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const [periodReturn, setPeriodReturn] = useState<FamilyPeriodReturn | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    familyPerformanceApi
      .periods(familyId)
      .then((p) => {
        if (cancelled) return;
        setOptions(p);
        if (p.length && !p.some((o) => o.code === period)) setPeriod(p[0].code);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      if (period === 'CUSTOM' && !customFrom) {
        setPeriodReturn(null);
        setLoading(false);
        return;
      }

      try {
        const pr =
          period === 'CUSTOM'
            ? await familyPerformanceApi.customReturn(
                familyId,
                new Date(customFrom),
                new Date(customTo),
              )
            : await familyPerformanceApi.periodReturn(familyId, period);
        if (cancelled) return;
        setPeriodReturn(pr);
      } catch (e: any) {
        if (cancelled) return;
        setError(
          e?.response?.data?.message || 'Could not load performance for this household',
        );
        setPeriodReturn(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [familyId, period, customFrom, customTo, refreshSignal]);

  useEffect(() => {
    onStateChange?.({ periodReturn, loading });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodReturn, loading]);

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

  if (loading) return <FamilySkeleton selector={selector} />;

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

  const r = periodReturn;

  return (
    <div className="space-y-6">
      {/* ── 1. The headline, for the household as one account. ──────────── */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <CardHeader
              title={r ? `${r.familyName} · ${r.label}` : 'Household performance'}
              subtitle={
                r ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {r.memberCount} {r.memberCount === 1 ? 'account' : 'accounts'}, measured as one
                    <span className="text-ink-tertiary">·</span>
                    {fmtDate(r.from)} → {fmtDate(r.to)}
                    <span className="text-ink-tertiary">·</span>
                    {r.periodDays} days
                  </span>
                ) : (
                  'Select a period'
                )
              }
            />
          </div>
          {selector}
        </div>

        {r ? (
          <>
            <WindowNotes r={r} />

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Headline
                label={`Family ${r.label} return`}
                value={r.returnPct}
                unavailable={r.returnReason}
                hint="Money-weighted (XIRR) across all accounts"
              />
              <StatTile
                label={r.benchmark ? `${r.benchmark.code} return` : 'Benchmark'}
                value={
                  r.benchmark?.interim != null
                    ? signedPct(r.benchmark.interim)
                    : r.benchmark
                      ? 'Not available'
                      : 'None set'
                }
                tone={
                  r.benchmark?.interim == null
                    ? 'neutral'
                    : r.benchmark.interim >= 0
                      ? 'pos'
                      : 'neg'
                }
                hint={r.benchmark ? 'Same window, same family flows' : undefined}
              />
              <StatTile
                label="Alpha"
                value={r.alpha !== null ? signedPct(r.alpha) : 'Not available'}
                tone={r.alpha === null ? 'neutral' : r.alpha >= 0 ? 'pos' : 'neg'}
                hint={
                  r.alpha !== null
                    ? 'Household − benchmark'
                    : 'Needs a benchmark and a solved return'
                }
              />
              <StatTile
                label="Family assets"
                value={formatCurrency(r.closingValue, currency)}
                hint={`Gain ${formatSignedCurrency(
                  r.closingValue - r.openingValue - r.netFlows,
                  currency,
                )} net of deposits`}
              />
            </div>

            {r.benchmark?.reason && (
              <p className="mt-3 text-[12px] leading-relaxed text-amber-600">
                {r.benchmark.reason}
              </p>
            )}
          </>
        ) : period === 'CUSTOM' && !customFrom ? (
          <p className="mt-4 text-[13px] text-ink-tertiary">
            Choose a &quot;From&quot; date to measure a custom range.
          </p>
        ) : null}
      </Card>

      {/* ── 2. Which account moved it. ──────────────────────────────────── */}
      {r && r.members.length > 0 && <MemberBreakdown r={r} />}

      {/* ── 3. How the household figure was built. The audit trail. ─────── */}
      {r && <Reconciliation r={r} />}
    </div>
  );
}

/**
 * The caveats that qualify the headline, stated where the headline is.
 *
 * Beyond the clamp and open-period notes the single-client sheet carries, a
 * household has one more: an account that joined mid-window. That is the fact
 * most likely to make a reader think the sheet is wrong — the family's assets
 * jumped and its return did not — so it is said in words, with the date.
 */
function WindowNotes({ r }: { r: FamilyPeriodReturn }) {
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
  for (const e of r.lateEntrants) {
    notes.push(
      `${e.clientName} joined this household on ${fmtDate(e.entryDate)}, inside the window. ` +
        `Its balance is counted as capital arriving on that date, not as household performance — ` +
        `so the family return measures only the growth earned after it joined.`,
    );
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
 * Every member account, each measured on its own, beneath the household figure.
 *
 * The footnote is load-bearing rather than decorative. The single most likely
 * misreading of this table is that the member returns should average to the
 * household return above — they should not, and a reader who assumes they do
 * will conclude the page has a bug. Gain is the column that reconciles, so the
 * table totals that column and says so.
 */
function MemberBreakdown({ r }: { r: FamilyPeriodReturn }) {
  const currency = useCurrency();
  const totalGain = r.members.reduce((s, m) => s + m.gain, 0);

  return (
    <Card>
      <CardHeader
        title="By account"
        subtitle="Each member measured on its own, the same figure its individual sheet shows"
      />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[12px] uppercase tracking-wide text-ink-tertiary">
              <th className="pb-2 font-medium">Account</th>
              <th className="pb-2 text-right font-medium">Opening</th>
              <th className="pb-2 text-right font-medium">Closing</th>
              <th className="pb-2 text-right font-medium">Weight</th>
              <th className="pb-2 text-right font-medium">Gain</th>
              <th className="pb-2 text-right font-medium">Return</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {r.members.map((m) => (
              <tr key={m.clientId}>
                <td className="py-2.5 font-semibold text-ink">
                  {m.clientName}
                  {m.entryDate && (
                    <Badge tone="neutral" className="ml-2">
                      joined {fmtDate(m.entryDate)}
                    </Badge>
                  )}
                </td>
                <td className="py-2.5 text-right tabular-nums text-ink-secondary">
                  {formatCurrency(m.openingValue, currency)}
                </td>
                <td className="py-2.5 text-right tabular-nums text-ink-secondary">
                  {formatCurrency(m.closingValue, currency)}
                </td>
                <td className="py-2.5 text-right tabular-nums text-ink-secondary">
                  {pct(m.weight)}
                </td>
                <td
                  className={cn(
                    'py-2.5 text-right font-semibold tabular-nums',
                    m.gain >= 0 ? 'text-emerald-600' : 'text-rose-600',
                  )}
                >
                  {formatSignedCurrency(m.gain, currency)}
                </td>
                <td
                  className={cn(
                    'py-2.5 text-right font-semibold tabular-nums',
                    m.returnPct === null
                      ? 'text-ink-tertiary'
                      : m.returnPct >= 0
                        ? 'text-emerald-600'
                        : 'text-rose-600',
                  )}
                  title={m.returnReason}
                >
                  {m.returnPct !== null ? signedPct(m.returnPct) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold text-ink">
              <td className="pt-2.5">Household</td>
              <td className="pt-2.5 text-right tabular-nums">
                {formatCurrency(r.openingValue, currency)}
              </td>
              <td className="pt-2.5 text-right tabular-nums">
                {formatCurrency(r.closingValue, currency)}
              </td>
              <td className="pt-2.5 text-right tabular-nums">100.0%</td>
              <td
                className={cn(
                  'pt-2.5 text-right tabular-nums',
                  totalGain >= 0 ? 'text-emerald-600' : 'text-rose-600',
                )}
              >
                {formatSignedCurrency(totalGain, currency)}
              </td>
              <td
                className={cn(
                  'pt-2.5 text-right tabular-nums',
                  r.returnPct === null
                    ? 'text-ink-tertiary'
                    : r.returnPct >= 0
                      ? 'text-emerald-600'
                      : 'text-rose-600',
                )}
              >
                {r.returnPct !== null ? signedPct(r.returnPct) : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-4 rounded-lg bg-surface-2 p-3 text-[12px] leading-relaxed text-ink-secondary">
        The account returns above do not average to the household return, and are not meant to. The
        household figure is one money-weighted return solved over the family&apos;s combined cash
        flows, so an account holding more capital for longer counts for more. Gain is the column
        that reconciles: the account gains sum to the household&apos;s.
      </p>
    </Card>
  );
}

/**
 * The working behind the household headline.
 *
 * Same table as the single-client sheet, with the flow line worded for a
 * household — on this sheet "deposits" includes an account joining, which is
 * money arriving into the family even though no member deposited anything.
 */
function Reconciliation({ r }: { r: FamilyPeriodReturn }) {
  const currency = useCurrency();
  const gap =
    r.returnPct !== null && r.simpleReturnPct !== null ? r.simpleReturnPct - r.returnPct : null;

  return (
    <Card>
      <CardHeader
        title="How this was calculated"
        subtitle="The household measured as one account, money-weighted over the selected window"
      />
      <div className="mt-4 divide-y divide-border">
        <Row
          label={`Combined opening value (${fmtDate(r.from)})`}
          value={formatCurrency(r.openingValue, currency)}
        />
        <Row
          label={
            r.lateEntrants.length
              ? 'Deposits − withdrawals, including accounts joining'
              : 'Deposits − withdrawals during the period'
          }
          value={formatSignedCurrency(r.netFlows, currency)}
        />
        <Row
          label={`Combined closing value (${fmtDate(r.to)})`}
          value={formatCurrency(r.closingValue, currency)}
        />
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

      {gap !== null && Math.abs(gap) > 0.0001 && (
        <p className="mt-4 rounded-lg bg-surface-2 p-3 text-[12px] leading-relaxed text-ink-secondary">
          The simple return reads {signedPct(gap)} higher than the money-weighted one because it
          treats the {formatSignedCurrency(r.netFlows, currency)} that entered this household during
          the window as performance. The money-weighted figure above does not, which is why it is
          the one reported.
        </p>
      )}
    </Card>
  );
}

/** The one number the sheet exists to show. Same treatment as the client sheet. */
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

function FamilySkeleton({ selector }: { selector: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Skeleton className="h-9 w-56" />
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
