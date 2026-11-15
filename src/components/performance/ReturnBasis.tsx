'use client';

import { formatCurrency, formatSignedCurrency, cn } from '@/lib/utils';
import { Card, CardHeader } from '@/components/ui';
import { returnBasis, signedPct, type ReturnFigures } from '@/lib/returnBasis';

/**
 * The basis logic lives in lib/returnBasis so the PDF and XLSX exports bind to
 * the very same function; re-exported here for the existing importers.
 */
export {
  ANNUALIZE_FROM_DAYS,
  returnBasis,
  signedPct,
  type ReturnBasis,
  type ReturnFigures,
} from '@/lib/returnBasis';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

const toneOf = (v: number | null) => (v === null ? undefined : v >= 0 ? 'pos' : 'neg');

/**
 * The headline tile. On a sub-year window the annualized XIRR rides along as a
 * muted pill; on a year or more the cumulative period figure does instead.
 */
export function ReturnHeadline({
  r,
  unavailable,
}: {
  r: ReturnFigures;
  unavailable?: string;
}) {
  const b = returnBasis(r);
  const value = b.portfolio;

  if (value === null) {
    return (
      <div className="rounded-xl border-2 border-border p-4">
        <p className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">
          {b.headlineLabel}
        </p>
        <p className="mt-2 text-[18px] font-semibold text-ink-tertiary">Not available</p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-tertiary">
          {unavailable ?? 'The return could not be solved for this window.'}
        </p>
      </div>
    );
  }

  const secondary = b.annual
    ? r.returnPct !== null
      ? `Cumulative: ${signedPct(r.returnPct)}`
      : null
    : r.annualizedReturnPct !== null
      ? `Annualized XIRR: ${signedPct(r.annualizedReturnPct)}`
      : null;

  return (
    <div
      className={cn(
        'rounded-xl border-2 p-4',
        value >= 0 ? 'border-emerald-200 bg-emerald-50/40' : 'border-rose-200 bg-rose-50/40',
      )}
    >
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-tertiary">
        {b.headlineLabel}
      </p>
      <p
        className={cn(
          'mt-2 text-[30px] font-semibold tabular-nums tracking-tight',
          value >= 0 ? 'text-emerald-600' : 'text-rose-600',
        )}
      >
        {signedPct(value)}
        {b.suffix && <span className="ml-1 text-[15px] font-medium">{b.suffix.trim()}</span>}
      </p>
      {secondary && (
        <span className="mt-1.5 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink-tertiary">
          {secondary}
        </span>
      )}
    </div>
  );
}

/**
 * Capital & Return Reconciliation: how opening value, net capital and
 * investment gain build the closing value, then the returns solved on them.
 */
export function CapitalReconciliation({
  r,
  currency,
  benchmarkLabel,
  consolidated,
}: {
  r: ReturnFigures;
  currency: string;
  benchmarkLabel: string | null;
  consolidated?: boolean;
}) {
  const b = returnBasis(r);
  const gain = r.closingValue - r.openingValue - r.netFlows;
  const window = `${fmtDate(r.from)} – ${fmtDate(r.to)}`;

  return (
    <Card>
      <CardHeader
        title="Capital & Return Reconciliation"
        subtitle={`${consolidated ? 'Consolidated cash' : 'Cash'} flow schedule and return methodology (${window})`}
      />

      <div className="mt-4 divide-y divide-border">
        <Row
          label={`Opening Portfolio Value (${fmtDate(r.from)})`}
          value={formatCurrency(r.openingValue, currency)}
        />
        <Row
          label="Net Capital Inflows / (Outflows)"
          value={formatSignedCurrency(r.netFlows, currency)}
        />
        <Row
          label="Net Investment Gain / (Loss)"
          value={formatSignedCurrency(gain, currency)}
          tone={toneOf(gain)}
        />
        <Row
          label={`Closing Portfolio Value (${fmtDate(r.to)})`}
          value={formatCurrency(r.closingValue, currency)}
          emphasis
        />
      </div>

      <div className="mt-1 divide-y divide-border border-t-2 border-border">
        <Row
          label="Period Money-Weighted Return (Absolute MWRR)"
          value={r.returnPct !== null ? signedPct(r.returnPct) : 'Not available'}
          tone={toneOf(r.returnPct)}
          emphasis
        />
        <Row
          label="Annualized Return (XIRR)"
          value={
            r.annualizedReturnPct !== null
              ? `${signedPct(r.annualizedReturnPct)} p.a.`
              : 'n/m (< 30 days)'
          }
          tone={toneOf(r.annualizedReturnPct)}
          muted={r.annualizedReturnPct === null}
        />
        <Row
          label={`Benchmark Return (${benchmarkLabel ?? 'Benchmark'} Cash-Flow Matched${b.annual ? ', p.a.' : ''})`}
          value={
            b.benchmark !== null
              ? `${signedPct(b.benchmark)}${b.suffix}`
              : r.benchmark
                ? 'Not available'
                : 'None set'
          }
          tone={toneOf(b.benchmark)}
          muted={b.benchmark === null}
        />
        <Row
          label={`Net Alpha (Excess Return${b.annual ? ', p.a.' : ''})`}
          value={b.alpha !== null ? `${signedPct(b.alpha)}${b.suffix}` : 'Not available'}
          tone={toneOf(b.alpha)}
          muted={b.alpha === null}
        />
      </div>
    </Card>
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
    <div className="flex items-center justify-between gap-4 py-2.5">
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
          'shrink-0 text-[13px] tabular-nums',
          emphasis && 'font-semibold',
          muted && 'text-ink-tertiary',
          !muted && tone === 'pos' && 'text-emerald-600',
          !muted && tone === 'neg' && 'text-rose-600',
          !muted && !tone && (emphasis ? 'text-ink' : 'text-ink-secondary'),
        )}
      >
        {value}
      </span>
    </div>
  );
}
