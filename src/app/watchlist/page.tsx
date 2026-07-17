'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Hash, Loader2, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { watchlistApi } from '@/lib/watchlist.api';
import { marketApi, SymbolNotFoundError } from '@/lib/market.api';
import { formatCurrency, formatSignedPct, cn } from '@/lib/utils';
import { Watchlist, WatchlistReturns, BenchmarkReturns, WatchlistFolder, WatchlistSlot } from '@/types';
import AppShell from '@/components/layout/AppShell';
import { Card, Input, Button, Tabs, Modal, Textarea, useToast } from '@/components/ui';

type LookupStatus = 'idle' | 'loading' | 'found' | 'notfound' | 'error';
const DEBOUNCE_MS = 500;
const SLOTS: WatchlistSlot[] = ['1', '2', '3', '4', '5'];

type Row = Watchlist & { returns?: WatchlistReturns; returnsLoading: boolean };
type SortKey = 'mtd' | 'qtd' | 'ytd';
type SortDir = 'asc' | 'desc';

export default function WatchlistPage() {
  const { toast } = useToast();
  const [slot, setSlot] = useState<WatchlistSlot>('1');
  const [folders, setFolders] = useState<WatchlistFolder[]>(SLOTS.map((s) => ({ slot: s, name: `Watchlist ${s}` })));
  const [renaming, setRenaming] = useState<WatchlistSlot | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [benchmarks, setBenchmarks] = useState<BenchmarkReturns[]>([]);
  const [benchmarksLoading, setBenchmarksLoading] = useState(true);

  const [ticker, setTicker] = useState('');
  const [status, setStatus] = useState<LookupStatus>('idle');
  const [preview, setPreview] = useState<{ company: string; sector: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const inflight = useRef<AbortController | null>(null);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);

  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  const loadReturns = useCallback(async (row: Watchlist) => {
    try {
      const returns = await watchlistApi.returnsFor(row.id);
      setItems((prev) => prev.map((r) => (r.id === row.id ? { ...r, returns, returnsLoading: false } : r)));
    } catch {
      setItems((prev) => prev.map((r) => (r.id === row.id ? { ...r, returnsLoading: false } : r)));
    }
  }, []);

  const loadList = useCallback(
    async (targetSlot: WatchlistSlot) => {
      setLoading(true);
      try {
        const data = await watchlistApi.list(targetSlot);
        const rows: Row[] = data.map((d) => ({ ...d, returnsLoading: true }));
        setItems(rows);
        rows.forEach((r) => loadReturns(r));
      } catch {
        toast({ tone: 'error', title: 'Failed to load watchlist' });
      } finally {
        setLoading(false);
      }
    },
    [loadReturns, toast]
  );

  useEffect(() => {
    watchlistApi
      .folders()
      .then(setFolders)
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadList(slot);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);

  useEffect(() => {
    (async () => {
      try {
        const data = await watchlistApi.benchmarks();
        setBenchmarks(data);
      } catch {
        toast({ tone: 'error', title: 'Failed to load benchmark returns' });
      } finally {
        setBenchmarksLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runLookup = useCallback(async (t: string) => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setStatus('loading');
    try {
      const data = await marketApi.lookup(t, controller.signal);
      if (controller.signal.aborted) return;
      setPreview({ company: data.company, sector: data.sector });
      setStatus('found');
    } catch (err) {
      if (controller.signal.aborted) return;
      setPreview(null);
      setStatus(err instanceof SymbolNotFoundError ? 'notfound' : 'error');
    }
  }, []);

  useEffect(() => {
    const t = ticker.trim().toUpperCase();
    if (t.length < 1) {
      inflight.current?.abort();
      setStatus('idle');
      setPreview(null);
      return;
    }
    const id = setTimeout(() => runLookup(t), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [ticker, runLookup]);

  useEffect(() => () => inflight.current?.abort(), []);

  const handleAdd = async () => {
    const t = ticker.trim().toUpperCase();
    if (!t || status === 'notfound') return;
    setAdding(true);
    try {
      const created = await watchlistApi.add(t, slot);
      const row: Row = { ...created, returnsLoading: true };
      setItems((prev) => [...prev, row]);
      loadReturns(row);
      setTicker('');
      setPreview(null);
      setStatus('idle');
      toast({ tone: 'success', title: `${created.ticker} added` });
    } catch (err: any) {
      const msg = err?.response?.status === 409 ? 'Already on this watchlist' : 'Could not add ticker';
      toast({ tone: 'error', title: msg });
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (item: Row) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await watchlistApi.remove(item.id);
      toast({ tone: 'success', title: `${item.ticker} removed` });
    } catch {
      toast({ tone: 'error', title: 'Failed to remove item' });
    }
  };

  const handleBulkImport = async () => {
    // Accept tickers separated by newlines, commas, tabs, or spaces —
    // matches pasting a single Excel column as well as a comma-separated list.
    const tickers = bulkText
      .split(/[\n,\t]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tickers.length === 0) return;

    setBulkLoading(true);
    try {
      const result = await watchlistApi.bulkAdd(tickers, slot);
      if (result.added.length > 0) {
        toast({ tone: 'success', title: `Added ${result.added.length} ticker${result.added.length === 1 ? '' : 's'}` });
      }
      if (result.skipped.length > 0) {
        toast({
          tone: 'error',
          title: `Skipped ${result.skipped.length}`,
          description: result.skipped.map((s) => `${s.ticker}: ${s.reason}`).join('; '),
        });
      }
      setBulkText('');
      setBulkOpen(false);
      loadList(slot);
    } catch {
      toast({ tone: 'error', title: 'Bulk import failed' });
    } finally {
      setBulkLoading(false);
    }
  };

  const startRename = (f: WatchlistFolder) => {
    setRenaming(f.slot);
    setRenameValue(f.name);
  };

  const submitRename = async () => {
    if (!renaming || !renameValue.trim()) {
      setRenaming(null);
      return;
    }
    try {
      const updated = await watchlistApi.renameFolder(renaming, renameValue.trim());
      setFolders((prev) => prev.map((f) => (f.slot === updated.slot ? updated : f)));
    } catch {
      toast({ tone: 'error', title: 'Could not rename watchlist' });
    } finally {
      setRenaming(null);
    }
  };

  const tickerHelper =
    status === 'loading'
      ? 'Looking up symbol…'
      : status === 'found' && preview
        ? `${preview.company}${preview.sector ? ` · ${preview.sector}` : ''}`
        : status === 'error'
          ? 'Lookup unavailable — try again'
          : status === 'notfound'
            ? 'Unknown ticker'
            : undefined;

  const primaryBenchmark = useMemo(() => benchmarks.find((b) => b.code === 'SP500') ?? benchmarks[0], [benchmarks]);
  const activeFolder = folders.find((f) => f.slot === slot);

  // Only the ticker rows sort — the S&P/Russell/Dow footer always stays in
  // its fixed order underneath, never mixed in.
  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return null; // third click clears back to insertion order
    });
  };

  const sortedItems = useMemo(() => {
    if (!sort) return items;
    const withValue = items.map((item) => ({ item, value: item.returns?.[sort.key].returnPct ?? null }));
    withValue.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1; // rows without data sink to the bottom regardless of direction
      if (b.value == null) return -1;
      return sort.dir === 'asc' ? a.value - b.value : b.value - a.value;
    });
    return withValue.map((w) => w.item);
  }, [items, sort]);

  const handleExport = () => {
    const header = ['Symbol', 'Company', 'Sector', 'Industry', 'Price', 'MTD %', 'QTD %', 'YTD %'];
    const rows = sortedItems.map((item) => [
      item.ticker,
      item.company,
      item.sector,
      item.industry,
      item.returns?.currentPrice ?? '',
      item.returns?.mtd.returnPct ?? '',
      item.returns?.qtd.returnPct ?? '',
      item.returns?.ytd.returnPct ?? '',
    ]);
    const benchmarkRows = benchmarks.map((b) => [b.label, '', '', '', '', b.mtd.returnPct ?? '', b.qtd.returnPct ?? '', b.ytd.returnPct ?? '']);
    const csv = [header, ...rows, [], ...benchmarkRows]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${(activeFolder?.name ?? 'watchlist').replace(/\s+/g, '_').toLowerCase()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <AppShell title="Watchlist" subtitle="Tickers under watch, with MTD / QTD / YTD performance vs. benchmarks">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            tabs={folders.map((f) => ({ value: f.slot, label: f.name }))}
            value={slot}
            onChange={(v) => setSlot(v as WatchlistSlot)}
          />
          <div className="flex items-center gap-2">
            {activeFolder && (
              <Button variant="ghost" size="sm" leftIcon={<Pencil className="h-3.5 w-3.5" />} onClick={() => startRename(activeFolder)}>
                Rename
              </Button>
            )}
            <Button variant="outline" size="sm" leftIcon={<Upload className="h-3.5 w-3.5" />} onClick={() => setBulkOpen(true)}>
              Import list
            </Button>
            <Button variant="outline" size="sm" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={handleExport} disabled={items.length === 0}>
              Export
            </Button>
          </div>
        </div>

        <Card padding="md">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Input
                label="Add ticker"
                placeholder="AAPL"
                leftIcon={<Hash className="h-4 w-4" />}
                rightAddon={status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin text-ink-tertiary" /> : undefined}
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                error={status === 'notfound' ? 'Unknown ticker' : undefined}
                success={status === 'found' ? tickerHelper : undefined}
                helper={status === 'found' ? undefined : tickerHelper}
                className="uppercase"
                autoComplete="off"
              />
            </div>
            <Button
              leftIcon={<Plus className="h-4 w-4" />}
              onClick={handleAdd}
              loading={adding}
              disabled={!ticker.trim() || status === 'notfound' || status === 'loading'}
            >
              Add to {activeFolder?.name ?? 'Watchlist'}
            </Button>
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
                  <SortableHeader label="MTD" sortKey="mtd" active={sort} onSort={toggleSort} />
                  <SortableHeader label="QTD" sortKey="qtd" active={sort} onSort={toggleSort} />
                  <SortableHeader label="YTD" sortKey="ytd" active={sort} onSort={toggleSort} />
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-ink-tertiary">
                      Loading…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-ink-tertiary">
                      No tickers on {activeFolder?.name ?? 'this watchlist'} yet. Add one above, or import a list.
                    </td>
                  </tr>
                ) : (
                  sortedItems.map((item) => (
                    <tr key={item.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-ink">{item.ticker}</p>
                        <p className="max-w-[200px] truncate text-xs text-ink-tertiary">{item.company}</p>
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">{item.sector || '—'}</td>
                      <td className="px-4 py-3 text-ink-secondary">{item.industry || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-ink">
                        {item.returnsLoading ? '…' : item.returns?.currentPrice != null ? formatCurrency(item.returns.currentPrice) : '—'}
                      </td>
                      <ReturnCell value={item.returns?.mtd.returnPct} loading={item.returnsLoading} benchmark={primaryBenchmark?.mtd.returnPct} />
                      <ReturnCell value={item.returns?.qtd.returnPct} loading={item.returnsLoading} benchmark={primaryBenchmark?.qtd.returnPct} />
                      <ReturnCell value={item.returns?.ytd.returnPct} loading={item.returnsLoading} benchmark={primaryBenchmark?.ytd.returnPct} />
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => handleDelete(item)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                {benchmarksLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-3 text-center text-xs text-ink-tertiary">
                      Loading benchmark returns…
                    </td>
                  </tr>
                ) : (
                  benchmarks.map((b) => (
                    <tr key={b.code} className="border-t border-border bg-surface-2">
                      <td className="px-4 py-3 font-semibold text-ink-secondary" colSpan={4}>
                        {b.label}
                      </td>
                      <ReturnCell value={b.mtd.returnPct} loading={false} plain />
                      <ReturnCell value={b.qtd.returnPct} loading={false} plain />
                      <ReturnCell value={b.ytd.returnPct} loading={false} plain />
                      <td className="px-4 py-3" />
                    </tr>
                  ))
                )}
              </tfoot>
            </table>
          </div>
        </Card>
      </div>

      <Modal
        isOpen={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename watchlist"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button onClick={submitRename}>Save</Button>
          </div>
        }
      >
        <Input
          label="Name"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submitRename()}
          autoFocus
        />
      </Modal>

      <Modal
        isOpen={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={`Import tickers into ${activeFolder?.name ?? 'watchlist'}`}
        description="Paste a column of tickers copied from Excel — one per line. Company, sector, and industry are looked up automatically."
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkImport} loading={bulkLoading} disabled={!bulkText.trim()}>
              Import
            </Button>
          </div>
        }
      >
        <Textarea
          label="Tickers"
          placeholder={'AAPL\nMSFT\nGOOGL'}
          rows={10}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          className="font-mono uppercase"
        />
      </Modal>
    </AppShell>
  );
}

function SortableHeader({
  label,
  sortKey,
  active,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: { key: SortKey; dir: SortDir } | null;
  onSort: (key: SortKey) => void;
}) {
  const isActive = active?.key === sortKey;
  return (
    <th className="px-4 py-3 text-right">
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

function ReturnCell({
  value,
  loading,
  benchmark,
  plain,
}: {
  value?: number | null;
  loading: boolean;
  benchmark?: number | null;
  plain?: boolean;
}) {
  if (loading) {
    return <td className="px-4 py-3 text-right text-ink-tertiary">…</td>;
  }
  if (value == null) {
    return <td className="px-4 py-3 text-right text-ink-tertiary">—</td>;
  }
  // Underperformance vs. the primary benchmark (S&P 500) is flagged in red;
  // everything else (including benchmark rows themselves) uses plain up/down coloring.
  const underperforms = !plain && benchmark != null && value < benchmark;
  return (
    <td
      className={cn(
        'px-4 py-3 text-right font-semibold tabular-nums',
        underperforms ? 'text-danger' : value >= 0 ? 'text-success' : 'text-danger'
      )}
    >
      {formatSignedPct(value)}
    </td>
  );
}
