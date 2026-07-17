'use client';

import { ReactNode, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  SlidersHorizontal,
  Download,
  Check,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from './Button';
import { Skeleton } from './Skeleton';
import { EmptyState } from './EmptyState';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  accessor: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  defaultHidden?: boolean;
  width?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
  searchKeys?: (row: T) => string;
  selectable?: boolean;
  pageSize?: number;
  bulkActions?: (selected: T[]) => ReactNode;
  onExport?: (rows: T[]) => void;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  toolbar?: ReactNode;
}

type SortDir = 'asc' | 'desc' | null;

export function DataTable<T>({
  columns,
  data,
  loading,
  rowKey,
  searchPlaceholder = 'Search…',
  searchKeys,
  selectable,
  pageSize = 8,
  bulkActions,
  onExport,
  onRowClick,
  emptyTitle = 'No records found',
  emptyDescription = 'Try adjusting your search or filters.',
  toolbar,
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(
    new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key))
  );
  const [colMenuOpen, setColMenuOpen] = useState(false);

  const visibleColumns = columns.filter((c) => !hidden.has(c.key));

  // --- filter ---
  const filtered = useMemo(() => {
    if (!query.trim()) return data;
    const q = query.toLowerCase();
    return data.filter((row) => {
      const hay = searchKeys
        ? searchKeys(row)
        : columns.map((c) => String(c.accessor(row))).join(' ');
      return hay.toLowerCase().includes(q);
    });
  }, [data, query, columns, searchKeys]);

  // --- sort ---
  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filtered;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const arr = [...filtered].sort((a, b) => {
      const av = col.accessor(a);
      const bv = col.accessor(b);
      if (typeof av === 'number' && typeof bv === 'number') return av - bv;
      return String(av).localeCompare(String(bv));
    });
    return sortDir === 'desc' ? arr.reverse() : arr;
  }, [filtered, sortKey, sortDir, columns]);

  // --- paginate ---
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paged = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir('asc');
    } else {
      setSortDir((d) => (d === 'asc' ? 'desc' : d === 'desc' ? null : 'asc'));
      if (sortDir === 'desc') setSortKey(null);
    }
  };

  const allPagedSelected = paged.length > 0 && paged.every((r) => selected.has(rowKey(r)));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPagedSelected) paged.forEach((r) => next.delete(rowKey(r)));
      else paged.forEach((r) => next.add(rowKey(r)));
      return next;
    });
  };
  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedRows = data.filter((r) => selected.has(rowKey(r)));

  return (
    <div className="card overflow-hidden p-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-[10px] border border-border bg-surface-2 pl-9 pr-3 text-[13px] text-ink placeholder:text-ink-tertiary focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/15"
          />
        </div>

        {toolbar}

        {/* Column visibility */}
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<SlidersHorizontal className="h-3.5 w-3.5" />}
            onClick={() => setColMenuOpen((v) => !v)}
          >
            Columns
          </Button>
          <AnimatePresence>
            {colMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setColMenuOpen(false)} />
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  className="absolute right-0 z-40 mt-2 w-52 rounded-[12px] border border-border bg-white p-1.5 shadow-lg"
                >
                  {columns.map((c) => {
                    const isHidden = hidden.has(c.key);
                    return (
                      <button
                        key={c.key}
                        onClick={() =>
                          setHidden((prev) => {
                            const next = new Set(prev);
                            next.has(c.key) ? next.delete(c.key) : next.add(c.key);
                            return next;
                          })
                        }
                        className="flex w-full items-center justify-between rounded-[8px] px-2.5 py-2 text-[13px] font-medium text-ink transition-colors hover:bg-surface-3"
                      >
                        {c.header}
                        <span
                          className={cn(
                            'flex h-4 w-4 items-center justify-center rounded-[5px] border',
                            !isHidden ? 'border-brand bg-brand text-white' : 'border-border-strong'
                          )}
                        >
                          {!isHidden && <Check className="h-3 w-3" />}
                        </span>
                      </button>
                    );
                  })}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        {onExport && (
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Download className="h-3.5 w-3.5" />}
            onClick={() => onExport(selectedRows.length ? selectedRows : sorted)}
          >
            Export
          </Button>
        )}
      </div>

      {/* Bulk action bar */}
      <AnimatePresence>
        {selectable && selected.size > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-border bg-brand-soft"
          >
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[13px] font-medium text-brand">
                {selected.size} selected
              </span>
              <div className="flex items-center gap-2">
                {bulkActions?.(selectedRows)}
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              {selectable && (
                <th className="w-10 px-4 py-3">
                  <Checkbox checked={allPagedSelected} onChange={toggleAll} />
                </th>
              )}
              {visibleColumns.map((c) => (
                <th
                  key={c.key}
                  style={{ width: c.width }}
                  className={cn(
                    'whitespace-nowrap px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary',
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
                  )}
                >
                  {c.sortable !== false ? (
                    <button
                      onClick={() => toggleSort(c.key)}
                      className={cn(
                        'inline-flex items-center gap-1 transition-colors hover:text-ink',
                        c.align === 'right' && 'flex-row-reverse'
                      )}
                    >
                      {c.header}
                      {sortKey === c.key ? (
                        sortDir === 'asc' ? (
                          <ChevronUp className="h-3.5 w-3.5 text-brand" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-brand" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              Array.from({ length: pageSize }).map((_, i) => (
                <tr key={i}>
                  {selectable && (
                    <td className="px-4 py-3.5">
                      <Skeleton className="h-4 w-4" />
                    </td>
                  )}
                  {visibleColumns.map((c) => (
                    <td key={c.key} className="px-4 py-3.5">
                      <Skeleton className="h-3.5 w-full max-w-[120px]" />
                    </td>
                  ))}
                </tr>
              ))
            ) : paged.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length + (selectable ? 1 : 0)}>
                  <EmptyState
                    icon={<Search className="h-5 w-5" />}
                    title={emptyTitle}
                    description={emptyDescription}
                  />
                </td>
              </tr>
            ) : (
              paged.map((row) => {
                const id = rowKey(row);
                const isSel = selected.has(id);
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      'group transition-colors',
                      isSel ? 'bg-brand-soft/50' : 'hover:bg-surface-2',
                      onRowClick && 'cursor-pointer'
                    )}
                  >
                    {selectable && (
                      <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSel} onChange={() => toggleRow(id)} />
                      </td>
                    )}
                    {visibleColumns.map((c) => (
                      <td
                        key={c.key}
                        className={cn(
                          'px-4 py-3.5 text-[13px] text-ink',
                          c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : 'text-left'
                        )}
                      >
                        {c.render ? c.render(row) : c.accessor(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!loading && sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p className="text-[13px] text-ink-tertiary">
            Showing{' '}
            <span className="font-medium text-ink-secondary">
              {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, sorted.length)}
            </span>{' '}
            of <span className="font-medium text-ink-secondary">{sorted.length}</span>
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              disabled={currentPage === 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: totalPages }).slice(0, 7).map((_, i) => {
              const p = i + 1;
              return (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={cn(
                    'h-9 min-w-9 rounded-[10px] px-2 text-[13px] font-medium tabular-nums transition-colors',
                    p === currentPage
                      ? 'bg-brand text-white'
                      : 'text-ink-secondary hover:bg-surface-3 hover:text-ink'
                  )}
                >
                  {p}
                </button>
              );
            })}
            <Button
              variant="outline"
              size="icon"
              disabled={currentPage === totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cn(
        'flex h-[18px] w-[18px] items-center justify-center rounded-[6px] border transition-colors',
        checked ? 'border-brand bg-brand text-white' : 'border-border-strong bg-white hover:border-brand'
      )}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  );
}

/** Simple CSV export helper. */
export function exportToCsv<T>(filename: string, columns: Column<T>[], rows: T[]) {
  const headers = columns.map((c) => c.header);
  const lines = rows.map((row) =>
    columns.map((c) => `"${String(c.accessor(row)).replace(/"/g, '""')}"`).join(',')
  );
  const csv = [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
