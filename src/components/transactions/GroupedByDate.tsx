'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { formatCurrency, cn } from '@/lib/utils';
import { Badge } from '@/components/ui';
import type { Column } from '@/components/ui';

/**
 * Rolls a flat transaction list up into one row per calendar day — a client
 * deploying capital across 18 instruments in one sitting produces 18 ledger
 * rows (one per instrument, sometimes more if the same day saw more than one
 * contribution), but reads as one event. The underlying rows are never
 * altered here: a TRANSACTIONAL client's XIRR is computed from every one of
 * them individually, so this is a display rollup only, expandable back to
 * the exact rows it summarizes.
 */
export function GroupedByDate<T extends { date: string | Date; amount: number; ticker?: string }>({
  rows,
  columns,
  rowKey,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
}) {
  const groups = useMemo(() => {
    const byDate = new Map<string, T[]>();
    for (const r of rows) {
      const key = new Date(r.date).toISOString().slice(0, 10);
      const list = byDate.get(key) ?? [];
      list.push(r);
      byDate.set(key, list);
    }
    return [...byDate.entries()]
      .map(([date, items]) => ({
        date,
        items,
        total: items.reduce((s, r) => s + Math.abs(r.amount), 0),
        instrumentCount: new Set(items.map((r) => r.ticker).filter(Boolean)).size,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [rows]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (date: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });

  if (groups.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center gap-2 py-16 text-center">
        <Layers className="h-5 w-5 text-ink-tertiary" />
        <p className="text-[13px] text-ink-secondary">No transactions to group</p>
      </div>
    );
  }

  return (
    <div className="card divide-y divide-border overflow-hidden p-0">
      {groups.map((g) => {
        const isOpen = expanded.has(g.date);
        return (
          <div key={g.date}>
            <button
              onClick={() => toggle(g.date)}
              className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
            >
              {isOpen ? (
                <ChevronDown className="h-4 w-4 shrink-0 text-ink-tertiary" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-tertiary" />
              )}
              <span className="w-28 shrink-0 text-[13px] font-semibold text-ink">
                {new Date(`${g.date}T00:00:00Z`).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              <Badge tone="neutral">
                {g.instrumentCount > 0
                  ? `${g.instrumentCount} instrument${g.instrumentCount === 1 ? '' : 's'}`
                  : `${g.items.length} entr${g.items.length === 1 ? 'y' : 'ies'}`}
              </Badge>
              <span className="ml-auto text-[13px] font-semibold tabular-nums text-ink">
                {formatCurrency(g.total)}
              </span>
            </button>

            {isOpen && (
              <div className="overflow-x-auto border-t border-border bg-surface-1">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-2">
                      {columns.map((c) => (
                        <th
                          key={c.key}
                          className={cn(
                            'whitespace-nowrap px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary',
                            c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                          )}
                        >
                          {c.header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {g.items.map((row) => (
                      <tr key={rowKey(row)}>
                        {columns.map((c) => (
                          <td
                            key={c.key}
                            className={cn(
                              'px-4 py-2.5 text-[13px] text-ink',
                              c.align === 'right'
                                ? 'text-right tabular-nums'
                                : c.align === 'center'
                                  ? 'text-center'
                                  : 'text-left'
                            )}
                          >
                            {c.render ? c.render(row) : c.accessor(row)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
