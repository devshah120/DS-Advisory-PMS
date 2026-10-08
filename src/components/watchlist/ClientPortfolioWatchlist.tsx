'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { watchlistApi } from '@/lib/watchlist.api';
import { clientsApi } from '@/lib/clients.api';
import { formatCurrency } from '@/lib/utils';
import { displayTicker } from '@/lib/market-scope';
import {
  Client,
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

/**
 * The Watchlist, filled from a client's book instead of typed in.
 *
 * Every position the client holds today is listed with MTD / QTD / YTD for
 * THEIR holding: money-weighted, so a top-up is not read as gain, and on the
 * client's own calendar (April–March on the Indian book, clamped to the
 * 30-June-2026 inception). The book's indices are pinned underneath, measured
 * over exactly the same dates.
 */
export default function ClientPortfolioWatchlist() {
  const { toast } = useToast();
  const { market, ready: marketReady } = useMarket();

  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientId, setClientId] = useState('');

  const [data, setData] = useState<Watchlist | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<{ key: ClientWatchlistWindow; dir: SortDir } | null>(null);
  // Only the latest request may land: switching clients mid-load must not let
  // the slower, earlier response paint the previous client's book.
  const requestSeq = useRef(0);

  // The selector lists the selected book's clients only, and a switch of book
  // clears the selection, since that client belongs to the other book.
  useEffect(() => {
    if (!marketReady) return;
    setClientId('');
    setData(null);
    setClientsLoading(true);
    clientsApi
      .list({ limit: 200, market })
      .then((list) => setClients([...list].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {
        setClients([]);
        toast({ tone: 'error', title: 'Could not load clients' });
      })
      .finally(() => setClientsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, marketReady]);

  const load = async (id: string) => {
    const seq = ++requestSeq.current;
    if (!id) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await watchlistApi.clientPortfolio(id);
      if (seq === requestSeq.current) setData(result);
    } catch {
      if (seq === requestSeq.current) {
        setData(null);
        toast({ tone: 'error', title: 'Could not load this client’s holdings' });
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    load(clientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const rows = data?.rows ?? [];
  const benchmarks = data?.benchmarks ?? [];
  // The book's headline index (Nifty 50 / S&P 500), first in the server's order.
  const primary = benchmarks[0];

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
    const header = ['Symbol', 'Company', 'Sector', 'Industry', 'Price', 'MTD %', 'QTD %', 'YTD %'];
    const body = sortedRows.map((r) => [
      displayTicker(r.symbol),
      r.company ?? '',
      r.sector,
      r.industry,
      r.price,
      r.mtd.returnPct ?? '',
      r.qtd.returnPct ?? '',
      r.ytd.returnPct ?? '',
    ]);
    const benchmarkRows = benchmarks.map((b) => [b.label, '', '', '', '', b.mtd ?? '', b.qtd ?? '', b.ytd ?? '']);
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
    link.download = `${data.clientName.replace(/\s+/g, '_').toLowerCase()}_watchlist_${data.asOf}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="space-y-6">
      <Card padding="md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Select
              label="Client"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={clientsLoading}
            >
              <option value="">
                {clientsLoading ? 'Loading clients…' : clients.length ? 'Select a client…' : 'No clients in this book'}
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => load(clientId)}
              disabled={!clientId || loading}
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
              {!clientId ? (
                <EmptyRow>Select a client to see their holdings.</EmptyRow>
              ) : loading ? (
                <EmptyRow>Valuing the book…</EmptyRow>
              ) : !data ? (
                <EmptyRow>Holdings could not be loaded.</EmptyRow>
              ) : rows.length === 0 ? (
                <EmptyRow>{data.clientName} holds no positions.</EmptyRow>
              ) : (
                sortedRows.map((row) => (
                  <HoldingRow
                    key={row.symbol}
                    row={row}
                    currency={data.currency}
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
          <p>
            Returns are money-weighted for this client&rsquo;s own holding, so purchases and sales inside a window are
            not counted as gain or loss. As of {fmtDate(data.asOf)}.
          </p>
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
  primary,
  isPartial,
  cellTitle,
}: {
  row: ClientWatchlistRow;
  currency: string;
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
