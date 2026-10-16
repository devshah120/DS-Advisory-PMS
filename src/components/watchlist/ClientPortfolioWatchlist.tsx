'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { watchlistApi } from '@/lib/watchlist.api';
import { clientsApi } from '@/lib/clients.api';
import { familiesApi } from '@/lib/families.api';
import { formatCurrency } from '@/lib/utils';
import { displayTicker } from '@/lib/market-scope';
import {
  Client,
  Family,
  ClientPortfolioWatchlist as Watchlist,
  ClientWatchlistRow,
  ClientWatchlistWindow,
  PositionWindowReturn,
} from '@/types';
import { useMarket } from '@/components/layout/MarketContext';
import { Card, Button, Select, useToast } from '@/components/ui';
import { ReturnCell, SortableHeader, type SortDir } from './WatchlistCells';

const WINDOWS: ClientWatchlistWindow[] = ['mtd', 'qtd', 'ytd'];
const COLUMN_LABEL: Record<ClientWatchlistWindow, string> = { mtd: 'MTD', qtd: 'QTD', ytd: 'YTD' };
const COLUMNS = 7;

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

const fmtQuantity = (qty: number) => qty.toLocaleString('en-IN', { maximumFractionDigits: 4 });

/**
 * The Watchlist, filled from a client's book instead of typed in.
 *
 * Every position the client holds today is listed with MTD / QTD / YTD for
 * THEIR holding: money-weighted, so a top-up is not read as gain, and on the
 * client's own calendar (April–March on the Indian book, clamped to the
 * 30-June-2026 inception). The book's indices are pinned underneath, measured
 * over exactly the same dates.
 *
 * A household can be picked in the same control. Its rows merge each symbol
 * across the members' accounts, and the server measures the merged holding as
 * one account, never as an average of the members' returns.
 */
export default function ClientPortfolioWatchlist() {
  const { toast } = useToast();
  const { market, ready: marketReady } = useMarket();

  const [clients, setClients] = useState<Client[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  // 'client:<id>' or 'family:<id>'. Both ids are opaque cuids, so the prefix is
  // what tells the loader which of the two lists a selection came from.
  const [subject, setSubject] = useState('');

  const [data, setData] = useState<Watchlist | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<{ key: ClientWatchlistWindow; dir: SortDir } | null>(null);
  // Only the latest request may land: switching clients mid-load must not let
  // the slower, earlier response paint the previous client's book.
  const requestSeq = useRef(0);

  // The selector lists the selected book's clients and households only, and a
  // switch of book clears the selection, since it belongs to the other book.
  useEffect(() => {
    if (!marketReady) return;
    setSubject('');
    setData(null);
    setClientsLoading(true);
    const byName = <T extends { name: string }>(list: T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));
    Promise.all([
      clientsApi.list({ limit: 200, market }).catch(() => {
        toast({ tone: 'error', title: 'Could not load clients' });
        return [] as Client[];
      }),
      // A failed family list must not cost the desk its individual accounts.
      familiesApi.list(market).catch(() => [] as Family[]),
    ])
      .then(([clientList, familyList]) => {
        setClients(byName(clientList));
        setFamilies(byName(familyList));
      })
      .finally(() => setClientsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, marketReady]);

  const load = async (selection: string) => {
    const seq = ++requestSeq.current;
    const [kind, id] = selection.split(':');
    if (!id) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result =
        kind === 'family' ? await watchlistApi.familyPortfolio(id) : await watchlistApi.clientPortfolio(id);
      if (seq === requestSeq.current) setData(result);
    } catch {
      if (seq === requestSeq.current) {
        setData(null);
        toast({
          tone: 'error',
          title: kind === 'family' ? 'Could not load this household’s holdings' : 'Could not load this client’s holdings',
        });
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    load(subject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  const rows = data?.rows ?? [];
  const benchmarks = data?.benchmarks ?? [];
  // The book's headline index (Nifty 50 / S&P 500), first in the server's order.
  const primary = benchmarks[0];
  const isFamily = data?.kind === 'family';

  const toggleSort = (key: ClientWatchlistWindow) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return null; // third click clears back to the default, largest position first
    });
  };

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const withValue = rows.map((row) => ({ row, value: row[sort.key].returnPct }));
    withValue.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return sort.dir === 'asc' ? a.value - b.value : b.value - a.value;
    });
    return withValue.map((w) => w.row);
  }, [rows, sort]);

  const isPartial = (w: ClientWatchlistWindow, r: PositionWindowReturn) =>
    !!data && r.measuredFrom > data.windows[w].from;

  const cellTitle = (w: ClientWatchlistWindow, r: PositionWindowReturn) => {
    if (r.returnPct == null) return r.reason ?? 'Not measurable over this window';
    if (isPartial(w, r)) return `Held from ${fmtDate(r.measuredFrom)}, so measured over a shorter span than the index`;
    return undefined;
  };

  const headerTitle = (w: ClientWatchlistWindow) => {
    if (!data) return undefined;
    const m = data.windows[w];
    const span = `${m.label}: ${fmtDate(m.from)} → ${fmtDate(m.to)}`;
    return m.nominalFrom ? `${span} (from ${fmtDate(m.from)} rather than ${fmtDate(m.nominalFrom)}: performance starts at inception)` : span;
  };

  const anyPartial = rows.some((r) => WINDOWS.some((w) => isPartial(w, r[w])));
  const clampedWindows = data ? WINDOWS.filter((w) => data.windows[w].nominalFrom) : [];

  const handleExport = () => {
    if (!data) return;
    // A household's sheet also says which accounts each row was merged from.
    const header = [
      'Symbol',
      'Company',
      ...(isFamily ? ['Held in'] : []),
      'Sector',
      'Industry',
      'Price',
      'MTD %',
      'QTD %',
      'YTD %',
    ];
    const body = sortedRows.map((r) => [
      displayTicker(r.symbol),
      r.company ?? '',
      ...(isFamily ? [r.holders.map((h) => `${h.clientName} (${h.quantity})`).join('; ')] : []),
      r.sector,
      r.industry,
      r.price,
      r.mtd.returnPct ?? '',
      r.qtd.returnPct ?? '',
      r.ytd.returnPct ?? '',
    ]);
    const blanks: string[] = Array(header.length - 4).fill('');
    const benchmarkRows = benchmarks.map((b) => [b.label, ...blanks, b.mtd ?? '', b.qtd ?? '', b.ytd ?? '']);
    const windowRows = WINDOWS.map((w) => [
      `${COLUMN_LABEL[w]} window`,
      `${data.windows[w].from} → ${data.windows[w].to}`,
    ]);
    const csv = [header, ...body, [], ...benchmarkRows, [], ...windowRows]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${data.name.replace(/\s+/g, '_').toLowerCase()}_watchlist_${data.asOf}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="space-y-6">
      <Card padding="md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            {/* Households first, then the individual accounts, in one control:
                the same grouping the Performance page uses. */}
            <Select
              label={families.length > 0 ? 'Client or household' : 'Client'}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={clientsLoading}
            >
              <option value="">
                {clientsLoading
                  ? 'Loading clients…'
                  : families.length > 0
                    ? 'Select a client or household…'
                    : clients.length > 0
                      ? 'Select a client…'
                      : 'No clients in this book'}
              </option>
              {families.length > 0 && (
                <optgroup label="Households">
                  {families.map((f) => (
                    <option key={f.id} value={`family:${f.id}`}>
                      {f.name} · {f.memberCount} {f.memberCount === 1 ? 'account' : 'accounts'}
                    </option>
                  ))}
                </optgroup>
              )}
              {clients.length > 0 && (
                <optgroup label={families.length > 0 ? 'Individual accounts' : 'Accounts'}>
                  {clients.map((c) => (
                    <option key={c.id} value={`client:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => load(subject)}
              disabled={!subject || loading}
            >
              Refresh
            </Button>
            <Button
              variant="outline"
              leftIcon={<Download className="h-3.5 w-3.5" />}
              onClick={handleExport}
              disabled={!data || rows.length === 0}
            >
              Export
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-ink-secondary">
                <th className="px-4 py-3">Symbol</th>
                <th className="px-4 py-3">Sector</th>
                <th className="px-4 py-3">Industry</th>
                <th className="px-4 py-3 text-right">Price</th>
                {WINDOWS.map((w) => (
                  <SortableHeader
                    key={w}
                    label={COLUMN_LABEL[w]}
                    sortKey={w}
                    active={sort}
                    onSort={toggleSort}
                    title={headerTitle(w)}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {!subject ? (
                <EmptyRow>
                  {families.length > 0
                    ? 'Select a client or household to see their holdings.'
                    : 'Select a client to see their holdings.'}
                </EmptyRow>
              ) : loading ? (
                <EmptyRow>Valuing the book…</EmptyRow>
              ) : !data ? (
                <EmptyRow>Holdings could not be loaded.</EmptyRow>
              ) : rows.length === 0 ? (
                <EmptyRow>{data.name} holds no positions.</EmptyRow>
              ) : (
                sortedRows.map((row) => (
                  <HoldingRow
                    key={row.symbol}
                    row={row}
                    currency={data.currency}
                    showHolders={isFamily}
                    primary={primary}
                    isPartial={isPartial}
                    cellTitle={cellTitle}
                  />
                ))
              )}
            </tbody>
            {data && !loading && (
              <tfoot>
                {benchmarks.map((b) => (
                  <tr key={b.code} className="border-t border-border bg-surface-2">
                    <td className="px-4 py-3 font-semibold text-ink-secondary" colSpan={4}>
                      {b.label}
                    </td>
                    {WINDOWS.map((w) => (
                      <ReturnCell key={w} value={b[w]} loading={false} plain />
                    ))}
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {data && !loading && rows.length > 0 && (
        <div className="space-y-1 text-xs text-ink-tertiary">
          {isFamily ? (
            <p>
              Each symbol combines every account in the household that holds it (
              {data.members.map((m) => m.name).join(', ')}), and its return is money-weighted for the household as one
              account, so purchases and sales inside a window, in any member&rsquo;s account, are not counted as gain or
              loss. As of {fmtDate(data.asOf)}.
            </p>
          ) : (
            <p>
              Returns are money-weighted for this client&rsquo;s own holding, so purchases and sales inside a window are
              not counted as gain or loss. As of {fmtDate(data.asOf)}.
            </p>
          )}
          {anyPartial && <p>† Position opened inside the window. Measured from its first purchase, so not compared to the index.</p>}
          {clampedWindows.map((w) => (
            <p key={w}>
              {COLUMN_LABEL[w]} ({data.windows[w].label}) is measured from {fmtDate(data.windows[w].from)}, the start of
              reported performance, rather than {fmtDate(data.windows[w].nominalFrom!)}.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={COLUMNS} className="px-4 py-8 text-center text-ink-tertiary">
        {children}
      </td>
    </tr>
  );
}

function HoldingRow({
  row,
  currency,
  showHolders,
  primary,
  isPartial,
  cellTitle,
}: {
  row: ClientWatchlistRow;
  currency: string;
  /** On a household: which member accounts the row was merged from. */
  showHolders: boolean;
  primary?: { mtd: number | null; qtd: number | null; ytd: number | null };
  isPartial: (w: ClientWatchlistWindow, r: PositionWindowReturn) => boolean;
  cellTitle: (w: ClientWatchlistWindow, r: PositionWindowReturn) => string | undefined;
}) {
  const priceMissing = row.priceStatus === 'missing';
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <p className="font-semibold text-ink">{displayTicker(row.symbol)}</p>
        {row.company && <p className="max-w-[200px] truncate text-xs text-ink-tertiary">{row.company}</p>}
        {showHolders && row.holders.length > 0 && (
          <p
            className="max-w-[200px] truncate text-xs text-ink-secondary"
            title={row.holders.map((h) => `${h.clientName}: ${fmtQuantity(h.quantity)}`).join('\n')}
          >
            {row.holders.length === 1 ? row.holders[0].clientName : `${row.holders.length} accounts`}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-ink-secondary">{row.sector || '—'}</td>
      <td className="px-4 py-3 text-ink-secondary">{row.industry || '—'}</td>
      <td
        className="px-4 py-3 text-right tabular-nums text-ink"
        title={
          priceMissing
            ? 'No close found for this symbol; average cost is shown in its place'
            : row.priceDate
              ? `Close of ${fmtDate(row.priceDate)}`
              : undefined
        }
      >
        {formatCurrency(row.price, currency)}
        {priceMissing && <span className="ml-0.5 text-ink-tertiary">*</span>}
      </td>
      {WINDOWS.map((w) => (
        <ReturnCell
          key={w}
          value={row[w].returnPct}
          loading={false}
          benchmark={primary?.[w]}
          partial={isPartial(w, row[w])}
          title={cellTitle(w, row[w])}
        />
      ))}
    </tr>
  );
}
