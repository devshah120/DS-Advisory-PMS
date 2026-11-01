'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import { formatSignedPct, cn } from '@/lib/utils';

/**
 * Table cells shared by the manual Watchlist and the client-portfolio one, so
 * the two tables cannot drift apart in how a return or a sort reads.
 */

export type SortDir = 'asc' | 'desc';

export function SortableHeader<K extends string>({
  label,
  sortKey,
  active,
  onSort,
  title,
  className,
}: {
  label: string;
  sortKey: K;
  active: { key: K; dir: SortDir } | null;
  onSort: (key: K) => void;
  title?: string;
  className?: string;
}) {
  const isActive = active?.key === sortKey;
  return (
    <th className={cn('px-4 py-3 text-right', className)} title={title}>
      <button
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 font-medium transition-colors hover:text-ink',
          isActive ? 'text-ink' : 'text-ink-secondary'
        )}
      >
        {label}
        {isActive ? (
          active.dir === 'desc' ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUp className="h-3 w-3" />
          )
        ) : (
          <ArrowDown className="h-3 w-3 opacity-30" />
        )}
      </button>
    </th>
  );
}

/**
 * A position's share of the book's return, tinted by sign as the exported
 * sheet is. Below the two-decimal display precision it reads as 0.00% and
 * stays unshaded, rather than painting rounding noise green or red.
 */
export function ContributionCell({
  value,
  title,
  bold,
  divider,
}: {
  value?: number | null;
  title?: string;
  bold?: boolean;
  /** Rules off the first contribution column from the returns to its left. */
  divider?: boolean;
}) {
  const edge = divider && 'border-l border-border';
  if (value == null) {
    return (
      <td className={cn('px-4 py-3 text-right text-ink-tertiary', edge)} title={title}>
        —
      </td>
    );
  }
  const tone =
    Math.abs(value) < 0.005 ? 'text-ink-secondary' : value > 0 ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger';
  return (
    <td
      className={cn('px-4 py-3 text-right tabular-nums', bold ? 'font-bold' : 'font-semibold', tone, edge)}
      title={title}
    >
      {formatSignedPct(value)}
    </td>
  );
}

export function ReturnCell({
  value,
  loading,
  benchmark,
  plain,
  title,
  partial,
}: {
  value?: number | null;
  loading: boolean;
  benchmark?: number | null;
  plain?: boolean;
  /** Tooltip. Replaces the default "no price history" text on an empty cell. */
  title?: string;
  /**
   * The figure covers less of the window than the benchmark does (a position
   * opened mid-window). Marked, and never flagged as underperforming, because
   * the two numbers are not measured over the same days.
   */
  partial?: boolean;
}) {
  if (loading) {
    return <td className="px-4 py-3 text-right text-ink-tertiary">…</td>;
  }
  // A null return is data we don't have, not a zero. Yahoo serves no daily
  // history for some thinly-traded NSE SME scrips (the '-SM' series) — only a
  // live quote — so there is no base close to measure the period against. The
  // dash is honest; the tooltip is what stops it reading as a broken cell.
  if (value == null) {
    return (
      <td
        className="px-4 py-3 text-right text-ink-tertiary"
        title={title ?? 'No price history available for this period'}
      >
        —
      </td>
    );
  }
  // Underperformance vs. the book's primary benchmark is flagged in red;
  // everything else (including benchmark rows themselves) uses plain up/down coloring.
  const underperforms = !plain && !partial && benchmark != null && value < benchmark;
  return (
    <td
      className={cn(
        'px-4 py-3 text-right font-semibold tabular-nums',
        underperforms ? 'text-danger' : value >= 0 ? 'text-success' : 'text-danger'
      )}
      title={title}
    >
      {formatSignedPct(value)}
      {partial && <span className="ml-0.5 align-super text-[10px] font-normal text-ink-tertiary">†</span>}
    </td>
  );
}
