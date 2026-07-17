'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Coins,
  Download,
  Percent,
  RefreshCw,
  Scale,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { clientsApi } from '@/lib/clients.api';
import {
  performanceApi,
  PerformanceMeta,
  PerformanceOk,
  PerformanceResponse,
} from '@/lib/performance.api';
import { Client } from '@/types';
import {
  cn,
  formatCompactCurrency,
  formatCurrency,
  formatSignedCurrency,
} from '@/lib/utils';
import AppShell from '@/components/layout/AppShell';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Select,
  Skeleton,
  useToast,
} from '@/components/ui';

/** Rate formatting. The engine speaks in fractions (0.12); people read percent. */
const pct = (v: number, dp = 2) => `${(v * 100).toFixed(dp)}%`;
const signedPct = (v: number, dp = 2) =>
  `${v > 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;

export default function PerformancePage() {
  const { toast } = useToast();

  const [clients, setClients] = useState<Client[] | null>(null);
  const [clientId, setClientId] = useState<string>('');
  const [result, setResult] = useState<PerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const list = await clientsApi.list({ limit: 200 });
        setClients(list);
        if (list.length) setClientId(list[0].id);
        else setLoading(false);
      } catch {
        toast({ tone: 'error', title: 'Could not load clients' });
        setClients([]);
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = useCallback(
    async (id: string) => {
      if (!id) return;
      try {
        setResult(await performanceApi.forClient(id));
      } catch {
        toast({ tone: 'error', title: 'Could not compute performance' });
        setResult(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!clientId) return;
    setLoading(true);
    load(clientId);
  }, [clientId, load]);

  const client = useMemo(
    () => clients?.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );

  return (
    <AppShell
      title="Performance"
      subtitle={
        result
          ? result.meta.method
          : 'Money-weighted returns, benchmark comparison and attribution'
      }
      actions={
        <>
          {clients && clients.length > 0 && (
            <Select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              aria-label="Client"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          <Button
            variant="outline"
            size="md"
            leftIcon={<Download className="h-4 w-4" />}
            disabled={!result || result.data.status !== 'ok'}
            onClick={() => result && exportSheet(result)}
          >
            Export
          </Button>
          <Button
            size="md"
            leftIcon={
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            }
            disabled={!clientId || refreshing}
            onClick={() => {
              setRefreshing(true);
              load(clientId);
            }}
          >
            Refresh
          </Button>
        </>
      }
    >
      {loading ? (
        <SheetSkeleton />
      ) : !clients?.length ? (
        <EmptyState
          title="No clients yet"
          description="Add a client, choose their accounting method, and their performance sheet appears here."
        />
      ) : !result ? (
        <EmptyState
          title="Nothing to show"
          description="The engine returned no result for this client."
        />
      ) : (
        <Sheet result={result} clientName={client?.name ?? ''} />
      )}
    </AppShell>
  );
}

function Sheet({
  result,
  clientName,
}: {
  result: PerformanceResponse;
  clientName: string;
}) {
  const { data, meta } = result;
  const transactional = data.accountingMethod === 'transactional';

  return (
    <div className="space-y-6">
      <MethodBanner meta={meta} transactional={transactional} />

      {meta.warnings.map((w) => (
        <Warning key={w} text={w} />
      ))}

      {data.status === 'insufficient' ? (
        <>
          <Card>
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div>
                <p className="text-[15px] font-semibold text-ink">
                  XIRR cannot be computed for {clientName || 'this client'}
                </p>
                {/* The reason, not a dash and not a zero. A "0.00%" here would read
                    as "we measured this and it's flat", which is a different and
                    false claim. */}
                <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
                  {data.reason}
                </p>
              </div>
            </div>
          </Card>
          <BookSection data={data} />
        </>
      ) : (
        <>
          <ReturnRow data={data} />
          <BenchmarkCard data={data} />
          <BookSection data={data} />
          <FlowsCard data={data} />
        </>
      )}
    </div>
  );
}

/**
 * Which methodology produced these numbers, and on what basis.
 *
 * This is not decoration. The same book yields a materially different XIRR under
 * the two methods — a client with idle cash sees a higher transactional figure
 * (cash excluded, so it cannot dilute) and a lower cash-flow figure (cash
 * included, and it earned nothing). A number without its method is not a number,
 * it is a rumour, so the sheet always says which one it used.
 */
function MethodBanner({
  meta,
  transactional,
}: {
  meta: PerformanceMeta;
  transactional: boolean;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone={transactional ? 'brand' : 'success'} dot>
              {transactional ? 'Transactional XIRR' : 'Cashflow XIRR'}
            </Badge>
            {transactional && (
              <>
                <Badge tone={meta.includeDividends ? 'neutral' : 'warning'}>
                  Dividends {meta.includeDividends ? 'included' : 'excluded'}
                </Badge>
                <Badge tone={meta.includeFees ? 'neutral' : 'warning'}>
                  Fees {meta.includeFees ? 'included' : 'excluded'}
                </Badge>
              </>
            )}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">
            <span className="font-medium text-ink-secondary">Cash flows:</span>{' '}
            {meta.flowBasis}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-tertiary">
            <span className="font-medium">Benchmark:</span> {meta.benchmarkBasis}
          </p>
        </div>
        <p className="shrink-0 text-[12px] tabular-nums text-ink-tertiary">
          as of {new Date(meta.asOf).toLocaleDateString()}
        </p>
      </div>
    </Card>
  );
}

function ReturnRow({ data }: { data: PerformanceOk }) {
  const alpha = data.alpha;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        label={
          data.accountingMethod === 'transactional'
            ? 'Transactional XIRR'
            : 'Cashflow XIRR'
        }
        value={data.xirr}
        format={signedPct}
        sublabel="annualized"
        icon={<Percent className="h-4 w-4" />}
        accent={data.xirr !== null && data.xirr >= 0 ? 'success' : 'danger'}
        // When XIRR has no solution, say so. A dash invites "no risk"; a zero is
        // a lie. The reason tells the operator what would fix it.
        unavailable={data.xirrReason}
      />
      <Kpi
        label="Interim Return"
        value={data.interimReturn}
        format={signedPct}
        sublabel={`over ${data.periodDays} days`}
        icon={<TrendingUp className="h-4 w-4" />}
        accent={
          data.interimReturn !== null && data.interimReturn >= 0 ? 'success' : 'danger'
        }
      />
      <Kpi
        label="Alpha"
        value={alpha}
        format={signedPct}
        sublabel={
          data.benchmark ? `vs ${data.benchmark.code}, annualized` : 'no benchmark set'
        }
        icon={<Scale className="h-4 w-4" />}
        accent={alpha !== null && alpha >= 0 ? 'success' : 'danger'}
        unavailable={
          data.benchmark?.reason ??
          (data.benchmark ? undefined : 'No benchmark configured for this client')
        }
      />
      <Kpi
        label="Total Gain"
        value={data.totalGain}
        format={(v) => formatSignedCurrency(v)}
        sublabel={
          data.absoluteReturn !== null
            ? `${signedPct(data.absoluteReturn)} absolute`
            : undefined
        }
        icon={<Wallet className="h-4 w-4" />}
        accent={data.totalGain >= 0 ? 'success' : 'danger'}
      />
    </div>
  );
}

/**
 * The benchmark, shown with its working.
 *
 * `units` and `value` are here so the figure can be tied back to the workbook's
 * Units / Total Units / S&P500 value columns. A benchmark number you cannot
 * reconcile is one you cannot defend, and the unit-purchase construction is
 * precisely the part most systems get wrong.
 */
function BenchmarkCard({ data }: { data: PerformanceOk }) {
  const b = data.benchmark;

  if (!b) {
    return (
      <Card>
        <CardHeader title="Benchmark" subtitle="Not configured" />
        <p className="mt-3 text-[13px] text-ink-secondary">
          No benchmark is set for this client, so Alpha cannot be computed. Assign one
          on the client record.
        </p>
      </Card>
    );
  }

  if (b.xirr === null) {
    return (
      <Card>
        <CardHeader title={`Benchmark — ${b.name}`} subtitle={b.code} />
        <div className="mt-3 flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-[13px] leading-relaxed text-ink-secondary">{b.reason}</p>
        </div>
      </Card>
    );
  }

  const rows: Array<[string, string, boolean?]> = [
    ['Benchmark XIRR (annualized)', signedPct(b.xirr)],
    ['Benchmark interim return', b.interim !== null ? signedPct(b.interim) : '—'],
    ['Units held', b.units !== null ? b.units.toFixed(4) : '—'],
    ['Benchmark value today', b.value !== null ? formatCurrency(b.value) : '—'],
  ];

  if (data.xirr !== null) {
    rows.push(['Portfolio XIRR (annualized)', signedPct(data.xirr)]);
    rows.push(['Alpha (annualized)', signedPct(data.xirr - b.xirr), true]);
  }
  if (data.interimReturn !== null && b.interim !== null) {
    rows.push([
      'Alpha (interim, same window)',
      signedPct(data.interimReturn - b.interim),
      true,
    ]);
  }

  return (
    <Card>
      <CardHeader
        title={`Benchmark — ${b.name}`}
        subtitle="Unit-purchase method: each cash flow buys index units at that day's close"
      />
      <div className="mt-4 divide-y divide-border">
        {rows.map(([label, value, emphasis]) => (
          <div key={label} className="flex items-center justify-between py-2.5">
            <span
              className={cn(
                'text-[13px]',
                emphasis ? 'font-semibold text-ink' : 'text-ink-secondary',
              )}
            >
              {label}
            </span>
            <span
              className={cn(
                'text-[13px] tabular-nums',
                emphasis ? 'font-semibold text-ink' : 'text-ink-secondary',
              )}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
      {/* Both Alphas are shown because they are different numbers and the brief
          and the workbook each use one. Annualizing magnifies a small interim
          gap, so on a young account the annualized spread overstates the edge. */}
      <p className="mt-3 text-[12px] leading-relaxed text-ink-tertiary">
        Annualized Alpha is Portfolio XIRR minus Benchmark XIRR. Interim Alpha is the
        same spread measured over the {data.periodDays}-day holding period — on a short
        window the annualized figure magnifies the gap.
      </p>
    </Card>
  );
}

/** The book itself: values, gains, and the KPIs that need no solver. */
function BookSection({
  data,
}: {
  data: PerformanceOk | (PerformanceResponse['data'] & { status: 'insufficient' });
}) {
  const ok = data.status === 'ok' ? data : null;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Portfolio Value"
          value={data.portfolioValue}
          format={(v) => formatCurrency(v)}
          sublabel={`${formatCompactCurrency(data.holdingsValue)} holdings + ${formatCompactCurrency(data.cashBalance)} cash`}
          icon={<Wallet className="h-4 w-4" />}
          accent="brand"
        />
        <Kpi
          label="Cash Balance"
          value={data.cashBalance}
          format={(v) => formatCurrency(v)}
          sublabel={`${pct(data.cashWeight, 1)} of the book`}
          icon={<Coins className="h-4 w-4" />}
          accent={data.cashWeight > 0.25 ? 'warning' : 'neutral'}
        />
        <Kpi
          label="Cash Drag"
          value={ok?.cashDrag ?? null}
          format={signedPct}
          // Positive drag is not a bug: cash protected the client through a fall.
          sublabel={
            ok?.cashDrag != null && ok.cashDrag > 0
              ? 'cash cushioned a decline'
              : 'return given up to idle cash'
          }
          icon={<Coins className="h-4 w-4" />}
          accent={ok?.cashDrag != null && ok.cashDrag >= 0 ? 'success' : 'warning'}
          unavailable={ok ? undefined : 'Needs a solvable return series'}
        />
        <Kpi
          label="Portfolio Turnover"
          value={data.portfolioTurnover}
          format={(v) => pct(v, 1)}
          sublabel="min(buys, sells) ÷ avg value"
          icon={<RefreshCw className="h-4 w-4" />}
          accent="neutral"
          unavailable={
            data.portfolioTurnover === null ? 'No trades on an empty book' : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Capital & Gains" />
          <div className="mt-4 divide-y divide-border">
            <Row label="Invested capital" value={ok ? formatCurrency(ok.investedCapital) : '—'} />
            <Row label="Realized proceeds" value={ok ? formatCurrency(ok.realizedProceeds) : '—'} />
            <Row label="Unrealized value" value={formatCurrency(data.holdingsValue)} />
            <Row label="Net deposits" value={formatCurrency(data.netDeposits)} />
            <Row label="Net withdrawals" value={formatCurrency(data.netWithdrawals)} />
            <Row
              label="Realized gain"
              value={formatSignedCurrency(data.realizedGain)}
              tone={data.realizedGain >= 0 ? 'pos' : 'neg'}
            />
            <Row
              label="Unrealized gain"
              value={formatSignedCurrency(data.unrealizedGain)}
              tone={data.unrealizedGain >= 0 ? 'pos' : 'neg'}
            />
            <Row label="Dividend income" value={formatCurrency(data.dividendIncome)} />
            <Row label="Fees" value={formatCurrency(data.fees)} />
            {ok && (
              <Row
                label="Total gain"
                value={formatSignedCurrency(ok.totalGain)}
                tone={ok.totalGain >= 0 ? 'pos' : 'neg'}
                emphasis
              />
            )}
            {ok && (
              <Row
                label="Absolute return"
                value={ok.absoluteReturn !== null ? signedPct(ok.absoluteReturn) : '—'}
                tone={
                  ok.absoluteReturn !== null && ok.absoluteReturn >= 0 ? 'pos' : 'neg'
                }
              />
            )}
            {ok && (
              <Row
                label="Annualized return"
                // Null below 30 days on purpose: annualizing a 3-day return
                // extrapolates a week of noise into "+840% a year".
                value={
                  ok.annualizedReturn !== null
                    ? signedPct(ok.annualizedReturn)
                    : 'Too short a window to annualize'
                }
                tone={
                  ok.annualizedReturn !== null && ok.annualizedReturn >= 0 ? 'pos' : 'neg'
                }
                muted={ok.annualizedReturn === null}
              />
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Best & Worst"
              subtitle="Ranked by return on cost, not by dollar P&L"
            />
            <div className="mt-4 space-y-3">
              {data.bestPerformer ? (
                <PerformerLine row={data.bestPerformer} positive />
              ) : (
                <p className="text-[13px] text-ink-tertiary">No priced positions.</p>
              )}
              {data.worstPerformer && (
                <PerformerLine row={data.worstPerformer} positive={false} />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Sector Allocation"
              // Cash is a real allocation line here, not a residual — it is
              // ~21% of this book, larger than any single position.
              subtitle="Share of total assets, cash included"
            />
            <div className="mt-4 space-y-2.5">
              {data.sectorAllocation.slices.length === 0 ? (
                <p className="text-[13px] text-ink-tertiary">No holdings.</p>
              ) : (
                data.sectorAllocation.slices.map((s) => (
                  <div key={s.key} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 truncate text-[13px] font-medium text-ink">
                      {s.key}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${Math.min(100, s.weight * 100)}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-[13px] font-semibold tabular-nums text-ink-secondary">
                      {pct(s.weight, 1)}
                    </span>
                  </div>
                ))
              )}
              {/* Surfaced, never buried in "Unknown": a reader who can see that
                  12% is unclassified can act on it. */}
              {data.sectorAllocation.unclassifiedWeight > 0 && (
                <p className="pt-1 text-[12px] text-amber-600">
                  {pct(data.sectorAllocation.unclassifiedWeight, 1)} of the book is
                  unclassified.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Top Holdings" subtitle="By market value" />
        {data.topHoldings.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-tertiary">No holdings.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-ink-tertiary">
                  <th className="pb-2 font-medium">Ticker</th>
                  <th className="pb-2 font-medium">Company</th>
                  <th className="pb-2 text-right font-medium">Value</th>
                  <th className="pb-2 text-right font-medium">Weight</th>
                  <th className="pb-2 text-right font-medium">Unrealized</th>
                  <th className="pb-2 text-right font-medium">Return</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.topHoldings.map((h) => (
                  <tr key={h.ticker}>
                    <td className="py-2.5 font-semibold text-ink">{h.ticker}</td>
                    <td className="py-2.5 truncate text-ink-secondary">{h.company}</td>
                    <td className="py-2.5 text-right tabular-nums text-ink-secondary">
                      {formatCurrency(h.marketValue)}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink-secondary">
                      {pct(h.weight, 1)}
                    </td>
                    <td
                      className={cn(
                        'py-2.5 text-right tabular-nums',
                        h.unrealizedPnl >= 0 ? 'text-emerald-600' : 'text-rose-600',
                      )}
                    >
                      {formatSignedCurrency(h.unrealizedPnl)}
                    </td>
                    <td
                      className={cn(
                        'py-2.5 text-right font-semibold tabular-nums',
                        (h.returnPct ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600',
                      )}
                    >
                      {h.returnPct !== null ? signedPct(h.returnPct) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** The exact series the XIRR was solved on. Shown so the number can be audited. */
function FlowsCard({ data }: { data: PerformanceOk }) {
  return (
    <Card>
      <CardHeader
        title="Cash Flow Series"
        subtitle={`${data.flows.length} flows solved, plus the terminal value on the valuation date`}
      />
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-left text-ink-tertiary">
              <th className="pb-2 font-medium">Date</th>
              <th className="pb-2 font-medium">Direction</th>
              <th className="pb-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.flows.map((f, i) => (
              <tr key={`${f.date}-${i}`}>
                <td className="py-2 tabular-nums text-ink-secondary">
                  {new Date(f.date).toLocaleDateString()}
                </td>
                <td className="py-2 text-ink-secondary">
                  {f.amount < 0 ? 'Money in' : 'Money out'}
                </td>
                <td className="py-2 text-right tabular-nums text-ink">
                  {formatCurrency(f.amount)}
                </td>
              </tr>
            ))}
            <tr className="bg-surface-2/50">
              <td className="py-2.5 font-semibold tabular-nums text-ink">
                {new Date(data.inceptionDate).toLocaleDateString()} → today
              </td>
              <td className="py-2.5 font-semibold text-ink">Terminal value</td>
              <td className="py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatCurrency(
                  data.accountingMethod === 'transactional'
                    ? data.holdingsValue
                    : data.portfolioValue,
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-tertiary">
        {data.accountingMethod === 'transactional'
          ? 'Terminal value is holdings only — the transactional method ignores idle cash, because it measures the return on capital actually deployed into positions.'
          : 'Terminal value is holdings plus cash — the cashflow method includes idle cash, because it is still the client’s money and it still counts against the return we report to them.'}
      </p>
    </Card>
  );
}

// ── Primitives ───────────────────────────────────────────────────────────────

/**
 * A KPI tile that can refuse to show a number.
 *
 * This is the one hard rule from the architecture doc, and it is the thing most
 * likely to get quietly dropped because the dashboard looks emptier without it:
 * `Alpha: —` and `Alpha: 0.00%` both read as "we measured this and it's fine".
 * Naming the gap is the only honest rendering, and it is also the one that tells
 * the operator what would fix it.
 */
function Kpi({
  label,
  value,
  format,
  sublabel,
  icon,
  accent = 'neutral',
  unavailable,
}: {
  label: string;
  value: number | null;
  format: (v: number) => string;
  sublabel?: string;
  icon?: React.ReactNode;
  accent?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
  unavailable?: string;
}) {
  const accents: Record<string, string> = {
    brand: 'bg-brand-soft text-brand',
    success: 'bg-emerald-50 text-emerald-600',
    warning: 'bg-amber-50 text-amber-600',
    danger: 'bg-rose-50 text-rose-600',
    neutral: 'bg-surface-3 text-ink-secondary',
  };

  const missing = value === null;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">
          {label}
        </p>
        {icon && (
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg',
              accents[missing ? 'neutral' : accent],
            )}
          >
            {icon}
          </span>
        )}
      </div>

      {missing ? (
        <>
          <p className="mt-3 text-[15px] font-semibold text-ink-tertiary">
            Not available
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-tertiary">
            {unavailable ?? 'Insufficient data'}
          </p>
        </>
      ) : (
        <>
          <p className="mt-3 text-[26px] font-semibold tabular-nums tracking-tight text-ink">
            {format(value)}
          </p>
          {sublabel && (
            <p className="mt-1 text-[12px] text-ink-tertiary">{sublabel}</p>
          )}
        </>
      )}
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
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'text-[13px] tabular-nums',
          muted && 'text-[12px] text-ink-tertiary',
          !muted && emphasis && 'font-semibold',
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

function PerformerLine({
  row,
  positive,
}: {
  row: { ticker: string; company: string; returnPct: number | null; unrealizedPnl: number };
  positive: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-ink">
          {row.ticker}
          <span className="ml-2 text-[12px] font-normal text-ink-tertiary">
            {positive ? 'Best' : 'Worst'}
          </span>
        </p>
        <p className="truncate text-[12px] text-ink-tertiary">{row.company}</p>
      </div>
      <div className="shrink-0 text-right">
        <p
          className={cn(
            'text-[15px] font-semibold tabular-nums',
            (row.returnPct ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600',
          )}
        >
          {row.returnPct !== null ? signedPct(row.returnPct) : '—'}
        </p>
        <p className="text-[12px] tabular-nums text-ink-tertiary">
          {formatSignedCurrency(row.unrealizedPnl)}
        </p>
      </div>
    </div>
  );
}

/**
 * Data-integrity notes from the engine — typically the stored cash balance
 * disagreeing with the ledger. Surfaced rather than silently corrected: a silent
 * fix hides a data-entry problem that will simply recur.
 */
function Warning({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <p className="text-[13px] leading-relaxed text-amber-900">{text}</p>
    </div>
  );
}

function exportSheet(result: PerformanceResponse) {
  const { data, meta } = result;
  if (data.status !== 'ok') return;

  const rows: Array<[string, string | number]> = [
    ['Method', meta.method],
    ['Cash flow basis', meta.flowBasis],
    ['As of', new Date(meta.asOf).toISOString().slice(0, 10)],
    ['Period (days)', data.periodDays],
    ['', ''],
    ['Portfolio value', data.portfolioValue],
    ['Holdings value', data.holdingsValue],
    ['Cash balance', data.cashBalance],
    ['Invested capital', data.investedCapital],
    ['Realized proceeds', data.realizedProceeds],
    ['Net deposits', data.netDeposits],
    ['Net withdrawals', data.netWithdrawals],
    ['Realized gain', data.realizedGain],
    ['Unrealized gain', data.unrealizedGain],
    ['Total gain', data.totalGain],
    ['Dividend income', data.dividendIncome],
    ['Fees', data.fees],
    ['', ''],
    ['XIRR (annualized)', data.xirr ?? 'n/a'],
    ['Interim return', data.interimReturn ?? 'n/a'],
    ['Absolute return', data.absoluteReturn ?? 'n/a'],
    ['Annualized return', data.annualizedReturn ?? 'n/a'],
    ['Benchmark', data.benchmark?.code ?? 'n/a'],
    ['Benchmark XIRR', data.benchmark?.xirr ?? 'n/a'],
    ['Alpha (annualized)', data.alpha ?? 'n/a'],
    ['Alpha (interim)', data.alphaInterim ?? 'n/a'],
    ['Cash drag', data.cashDrag ?? 'n/a'],
    ['Portfolio turnover', data.portfolioTurnover ?? 'n/a'],
  ];

  const csv = rows
    .map(([k, v]) => `"${String(k).replace(/"/g, '""')}","${String(v).replace(/"/g, '""')}"`)
    .join('\n');

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `performance-${new Date(meta.asOf).toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function SheetSkeleton() {
  return (
    <div className="space-y-6">
      <div className="card p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-4 w-full max-w-lg" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-4 h-7 w-32" />
            <Skeleton className="mt-3 h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-6 h-[220px] w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
