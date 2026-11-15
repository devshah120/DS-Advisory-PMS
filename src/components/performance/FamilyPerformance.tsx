'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Info, Users } from 'lucide-react';
import {
  familyPerformanceApi,
  FamilyPeriodReturn,
} from '@/lib/family-performance.api';
import { PeriodOption } from '@/lib/portfolio-history.api';
import { formatCurrency, formatSignedCurrency, cn } from '@/lib/utils';
import { useCurrency, useMarket } from '@/components/layout/MarketContext';
import { Button, Card, CardHeader, Input, Select, Skeleton, useToast } from '@/components/ui';
import {
  CapitalReconciliation,
  ReturnHeadline,
  returnBasis,
  signedPct,
} from '@/components/performance/ReturnBasis';
import { MARKET_BENCHMARKS } from '@/lib/market-scope';
import { clientsApi } from '@/lib/clients.api';
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
 * The member returns do NOT average to the household return, and are not
 * supposed to: the household is one XIRR over the family's combined flows. The
 * column that reconciles is Net Gain, which sums exactly.
 *
 * Reporting basis (see ReturnBasis): sub-year windows lead with the period
 * money-weighted return; a year or more leads with XIRR p.a.
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
  const [customTo, setCustomTo] = useState<string>(todayIso);

  const [periodReturn, setPeriodReturn] = useState<FamilyPeriodReturn | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  /**
   * Which index to measure the household against. Null = its own (the
   * members' shared benchmark, else the book default). Keyed by family so
   * switching household drops the comparison in the same render.
   */
  const { toast } = useToast();
  const { market } = useMarket();
  const benchmarkOptions = MARKET_BENCHMARKS[market];
  const [compare, setCompare] = useState<{ familyId: string; code: string } | null>(null);
  const compareCode = compare?.familyId === familyId ? compare.code : null;
  const [savingDefault, setSavingDefault] = useState(false);
  const assignedCode = periodReturn?.assignedBenchmarkCode ?? null;
  const benchmarkLabel = (code: string | null | undefined) =>
    benchmarkOptions.find((b) => b.code === code)?.label ?? code ?? 'Benchmark';

  /**
   * Saves the compared index on every member, so the household and each
   * member's own sheet, exports and review packs all use it from now on.
   */
  async function applyToMembers(code: string, memberIds: string[]) {
    setSavingDefault(true);
    const results = await Promise.allSettled(
      memberIds.map((id) => clientsApi.update(id, { benchmark: code })),
    );
    const failed = results.filter((x) => x.status === 'rejected').length;
    toast(
      failed
        ? {
            tone: 'error',
            title: `${benchmarkLabel(code)} saved on ${memberIds.length - failed} of ${memberIds.length} members — ${failed} failed`,
          }
        : { tone: 'success', title: `${benchmarkLabel(code)} is now the benchmark for all ${memberIds.length} members` },
    );
    if (!failed) setCompare(null);
    setReloadTick((t) => t + 1);
    setSavingDefault(false);
  }

  /**
   * The floor for the date picker: this client's own inception, as reported by
   * the periods endpoint. Falls back to the house date only until the options
   * have loaded — every option carries the same value, so the first one does.
   */
  const inceptionIso = options[0]?.inceptionIso ?? DEFAULT_INCEPTION_ISO;

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

      /**
       * Hold off while a custom range is still being typed.
       *
       * A native date input fires on every keystroke, so typing the year 2026
       * passes through 0002 / 0020 / 0202 first. Fetching those asks the engine
       * to measure from the year 26 AD, which it answers — correctly, and
       * bafflingly — with "36510 days short of the full window". Waiting for a
       * complete, in-range pair keeps the previously loaded window on screen
       * instead of replacing it with a warning about a date nobody chose.
       */
      if (period === 'CUSTOM' && !isUsableRange(customFrom, customTo, inceptionIso)) {
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
                compareCode ?? undefined,
              )
            : await familyPerformanceApi.periodReturn(familyId, period, compareCode ?? undefined);
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
  }, [familyId, period, customFrom, customTo, compareCode, reloadTick, refreshSignal]);

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
          setCompare(!code || code === assignedCode ? null : { familyId, code });
        }}
      >
        {!assignedCode && !compareCode && <option value="">Household benchmark</option>}
        {benchmarkOptions.map((b) => (
          <option key={b.code} value={b.code}>
            vs {b.label}
            {b.code === assignedCode ? ' (household default)' : ''}
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
                    {r.memberCount} {r.memberCount === 1 ? 'account' : 'accounts'} · consolidated
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

            <HeadlineRow r={r} benchmarkLabel={benchmarkLabel} />

            {r.benchmark?.reason && (
              <p className="mt-3 text-[12px] leading-relaxed text-amber-600">
                {r.benchmark.reason}
              </p>
            )}

            {/* A comparison is a what-if until saved — said beside the figures so
                a screenshot of it is never mistaken for the household's own. */}
            {compareCode && compareCode !== assignedCode && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 p-3">
                <p className="text-[12px] leading-relaxed text-ink-secondary">
                  Comparing against{' '}
                  <span className="font-semibold text-ink">{benchmarkLabel(compareCode)}</span> for
                  this view only. The household&apos;s benchmark is {benchmarkLabel(assignedCode)}.
                </p>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setCompare(null)}>
                    Reset
                  </Button>
                  {r.members.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={savingDefault}
                      onClick={() =>
                        applyToMembers(
                          compareCode,
                          r.members.map((m) => m.clientId),
                        )
                      }
                    >
                      {savingDefault
                        ? 'Saving…'
                        : `Use ${benchmarkLabel(compareCode)} for all ${r.members.length} members`}
                    </Button>
                  )}
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

      {/* ── 2. Which account moved it. ──────────────────────────────────── */}
      {r && r.members.length > 0 && <MemberBreakdown r={r} />}

      {/* ── 3. How the household figure was built. The audit trail. ─────── */}
      {r && (
        <CapitalReconciliation
          r={r}
          currency={currency}
          benchmarkLabel={r.benchmark ? benchmarkLabel(r.benchmark.code) : null}
          consolidated
        />
      )}
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
      `Measured from inception (30 Jun 2026); ${r.label} nominally opens ${fmtDate(r.nominalFrom)} — ` +
        `${r.daysClamped} days excluded.`,
    );
  }
  if (r.openPeriod) {
    notes.push(`Period open — measured to ${fmtDate(r.to)}.`);
  }
  for (const e of r.lateEntrants) {
    notes.push(
      `${e.clientName} onboarded ${fmtDate(e.entryDate)}; transferred-in balance treated as a capital inflow.`,
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
 * Member returns do not average to the household return (that is one XIRR over
 * the combined flows); Net Gain is the column that reconciles, so the footer
 * totals it. Net Flows sits beside Opening so an account funded mid-window
 * never shows a bare zero opening with no context.
 */
function MemberBreakdown({ r }: { r: FamilyPeriodReturn }) {
  const currency = useCurrency();
  const annual = returnBasis(r).annual;
  const totalGain = r.members.reduce((s, m) => s + m.gain, 0);
  const memberReturn = (m: FamilyPeriodReturn['members'][number]) =>
    annual ? m.annualizedReturnPct : m.returnPct;
  const householdReturn = annual ? r.annualizedReturnPct : r.returnPct;

  const th = 'pb-2 text-right font-medium';
  const td = 'py-2.5 text-right tabular-nums text-ink-secondary';
  const signTone = (v: number | null) =>
    v === null ? 'text-ink-tertiary' : v >= 0 ? 'text-emerald-600' : 'text-rose-600';

  return (
    <Card>
      <CardHeader
        title="By account"
        subtitle="Individual portfolio attribution and capital allocation breakdown"
      />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-[12px] uppercase tracking-wide text-ink-tertiary">
              <th className="pb-2 font-medium">Account / Member</th>
              <th className={th}>Opening</th>
              <th className={th}>Net Flows</th>
              <th className={th}>Closing</th>
              <th className={th}>Weight</th>
              <th className={th}>Net Gain</th>
              <th className={th}>{annual ? 'Return p.a.' : 'Return'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {r.members.map((m) => {
              const ret = memberReturn(m);
              return (
                <tr key={m.clientId}>
                  <td className="py-2.5">
                    <span className="font-semibold text-ink">{m.clientName}</span>
                    {m.sinceDate && (
                      <span className="block text-[11px] font-normal text-ink-tertiary">
                        Since {fmtDate(m.sinceDate)}
                      </span>
                    )}
                  </td>
                  <td className={td}>{formatCurrency(m.openingValue, currency)}</td>
                  <td className={td}>
                    {m.netFlows === 0 ? (
                      <span className="text-ink-tertiary">{formatCurrency(0, currency)}</span>
                    ) : (
                      formatSignedCurrency(m.netFlows, currency)
                    )}
                  </td>
                  <td className={td}>{formatCurrency(m.closingValue, currency)}</td>
                  <td className={td}>{pct(m.weight)}</td>
                  <td className={cn(td, 'font-semibold', signTone(m.gain))}>
                    {formatSignedCurrency(m.gain, currency)}
                  </td>
                  <td
                    className={cn(td, 'font-semibold', signTone(ret))}
                    title={ret === null ? m.returnReason : undefined}
                  >
                    {ret !== null ? signedPct(ret) : annual && m.returnPct !== null ? 'n/m' : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold text-ink">
              <td className="pt-2.5">Household</td>
              <td className="pt-2.5 text-right tabular-nums">
                {formatCurrency(r.openingValue, currency)}
              </td>
              <td className="pt-2.5 text-right tabular-nums">
                {formatSignedCurrency(r.netFlows, currency)}
              </td>
              <td className="pt-2.5 text-right tabular-nums">
                {formatCurrency(r.closingValue, currency)}
              </td>
              <td className="pt-2.5 text-right tabular-nums">100.0%</td>
              <td className={cn('pt-2.5 text-right tabular-nums', signTone(totalGain))}>
                {formatSignedCurrency(totalGain, currency)}
              </td>
              <td className={cn('pt-2.5 text-right tabular-nums', signTone(householdReturn))}>
                {householdReturn !== null ? signedPct(householdReturn) : '—'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-ink-tertiary">
        Note: Consolidated household return is capital-weighted across combined cash flows;
        individual member gains sum precisely to total household net gain.
      </p>
    </Card>
  );
}

/** Headline return, benchmark, alpha and assets — all on the window's reporting basis. */
function HeadlineRow({
  r,
  benchmarkLabel,
}: {
  r: FamilyPeriodReturn;
  benchmarkLabel: (code: string | null | undefined) => string;
}) {
  const currency = useCurrency();
  const basis = returnBasis(r);
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
        label="Household assets"
        value={formatCurrency(r.closingValue, currency)}
        hint={`Net gain ${formatSignedCurrency(r.closingValue - r.openingValue - r.netFlows, currency)}`}
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
