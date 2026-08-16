'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Newspaper,
  RefreshCw,
  FileText,
  ExternalLink,
  Eye,
  Search,
} from 'lucide-react';
import { newsApi } from '@/lib/news.api';
import { cn } from '@/lib/utils';
import { useMarket } from '@/components/layout/MarketContext';
import { NewsFeedItem, NewsTag } from '@/types';
import { usePageHeading } from '@/components/layout/PageHeaderContext';
import { Badge, Button, EmptyState, SkeletonText, useToast } from '@/components/ui';

/**
 * Tag styling. Tones are chosen by what the news means for a position rather
 * than by sentiment — a buyback and a results print are both "notable", and
 * guessing good/bad from a headline would be dishonest.
 */
const TAG_META: Record<NewsTag, { label: string; tone: 'brand' | 'success' | 'info' | 'warning' | 'neutral' }> = {
  RESULTS: { label: 'Results', tone: 'brand' },
  BUYBACK: { label: 'Buyback', tone: 'success' },
  'M&A': { label: 'M&A', tone: 'warning' },
  DIVIDEND: { label: 'Dividend', tone: 'success' },
  MANAGEMENT: { label: 'Management', tone: 'info' },
  RATING: { label: 'Rating', tone: 'info' },
  ORDER: { label: 'Order Win', tone: 'neutral' },
};

const TAG_FILTERS: Array<{ value: NewsTag | 'ALL' | 'FILINGS'; label: string }> = [
  { value: 'ALL', label: 'Everything' },
  { value: 'FILINGS', label: 'Exchange filings' },
  { value: 'RESULTS', label: 'Results' },
  { value: 'M&A', label: 'M&A' },
  { value: 'BUYBACK', label: 'Buybacks' },
  { value: 'DIVIDEND', label: 'Dividends' },
  { value: 'MANAGEMENT', label: 'Management' },
  { value: 'RATING', label: 'Ratings' },
];

/**
 * Relative age, which is how a reader actually judges news. Falls back to an
 * absolute date past a week, where "13 days ago" stops being easier to parse
 * than the date itself.
 */
function relativeAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d ago`;

  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Calendar-day bucket heading: Today / Yesterday / an absolute date. */
function dayHeading(iso: string): string {
  const date = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  const days = Math.round((startOf(new Date()) - startOf(date)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
  });
}

export default function NewsPage() {
  const { market, meta, ready: marketReady } = useMarket();

  usePageHeading({
    title: 'News Center',
    subtitle: `Latest updates and filings across the ${meta.label} book`,
  });

  const { toast } = useToast();
  const [items, setItems] = useState<NewsFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tagFilter, setTagFilter] = useState<NewsTag | 'ALL' | 'FILINGS'>('ALL');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      setItems(await newsApi.feed(market));
    } catch {
      toast({ tone: 'error', title: 'Failed to load the news feed' });
    } finally {
      setLoading(false);
    }
  }, [toast, market]);

  // Re-loads on a book switch, showing the spinner so the feed never displays
  // the previous market's stories under the new selector.
  useEffect(() => {
    if (!marketReady) return;
    setLoading(true);
    void load();
  }, [load, marketReady]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { created } = await newsApi.refresh();
      await load();
      toast({
        tone: 'success',
        title: created > 0 ? `${created} new ${created === 1 ? 'story' : 'stories'}` : 'Feed is up to date',
      });
    } catch {
      toast({ tone: 'error', title: 'Refresh failed — a news source may be unavailable' });
    } finally {
      setRefreshing(false);
    }
  }, [load, toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (tagFilter === 'FILINGS' && item.kind !== 'FILING') return false;
      if (tagFilter !== 'ALL' && tagFilter !== 'FILINGS' && item.tag !== tagFilter) return false;

      if (!q) return true;
      // Symbol, company and headline are the three things someone scans for.
      return (
        item.symbol.toLowerCase().includes(q) ||
        item.company.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q)
      );
    });
  }, [items, tagFilter, query]);

  /** Grouped into calendar days so the feed reads as a timeline. */
  const grouped = useMemo(() => {
    const buckets: Array<{ heading: string; items: NewsFeedItem[] }> = [];
    for (const item of filtered) {
      const heading = dayHeading(item.publishedAt);
      const last = buckets[buckets.length - 1];
      if (last && last.heading === heading) last.items.push(item);
      else buckets.push({ heading, items: [item] });
    }
    return buckets;
  }, [filtered]);

  const filingCount = useMemo(() => items.filter((i) => i.kind === 'FILING').length, [items]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by symbol, company or headline"
            className="h-9 w-full rounded-[10px] border border-border bg-surface-2 pl-9 pr-3 text-[13px] text-ink placeholder:text-ink-tertiary focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/15"
          />
        </div>

        <div className="flex items-center gap-2 text-[13px] text-ink-tertiary">
          <span className="tabular-nums">{filtered.length} stories</span>
          {filingCount > 0 && (
            <span className="tabular-nums">· {filingCount} filings</span>
          )}
        </div>

        <Button onClick={handleRefresh} disabled={refreshing} variant="secondary">
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {/* Tag filters */}
      <div className="flex flex-wrap gap-1.5">
        {TAG_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setTagFilter(f.value)}
            className={cn(
              'rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              tagFilter === f.value
                ? 'bg-brand text-white'
                : 'bg-surface-3 text-ink-secondary hover:bg-surface-2 hover:text-ink',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonText key={i} lines={2} />
          ))}
        </div>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={<Newspaper className="h-6 w-6" />}
            title={items.length === 0 ? 'No news stored yet' : 'Nothing matches this filter'}
            description={
              items.length === 0
                ? `Press Refresh to pull the latest coverage and filings for every name the ${meta.label} book holds or watches.`
                : 'Try a different tag or clear the search.'
            }
            action={
              items.length === 0 ? (
                <Button onClick={handleRefresh} disabled={refreshing}>
                  <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
                  Fetch news
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((bucket) => (
            <section key={bucket.heading}>
              <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
                {bucket.heading}
              </h2>
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                {bucket.items.map((item, index) => (
                  <NewsRow key={item.id} item={item} first={index === 0} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function NewsRow({ item, first }: { item: NewsFeedItem; first: boolean }) {
  const isFiling = item.kind === 'FILING';
  const tag = item.tag ? TAG_META[item.tag] : null;

  return (
    <a
      href={item.url}
      target="_blank"
      // noreferrer alongside noopener: these are third-party links and the
      // referrer would leak the app's internal URL to the publisher.
      rel="noopener noreferrer"
      className={cn(
        'group flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2',
        !first && 'border-t border-border',
      )}
    >
      {/* Source marker — a filing is authoritative, so it reads differently. */}
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]',
          isFiling ? 'bg-brand-soft text-brand' : 'bg-surface-3 text-ink-tertiary',
        )}
        title={isFiling ? 'Exchange filing' : 'Press coverage'}
      >
        {isFiling ? <FileText className="h-3.5 w-3.5" /> : <Newspaper className="h-3.5 w-3.5" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-semibold text-ink">{item.symbol}</span>
          <span className="max-w-[220px] truncate text-xs text-ink-tertiary">{item.company}</span>

          {tag && <Badge tone={tag.tone}>{tag.label}</Badge>}

          {/* Exposure: a held name outranks a watchlist candidate. */}
          {item.watchlistOnly ? (
            <Badge tone="neutral">
              <Eye className="mr-1 h-3 w-3" />
              Watchlist
            </Badge>
          ) : (
            <span className="text-xs text-ink-tertiary">
              {item.clientCount} {item.clientCount === 1 ? 'client' : 'clients'}
            </span>
          )}
        </div>

        <p className="text-[13.5px] font-medium leading-snug text-ink group-hover:text-brand">
          {item.title}
        </p>

        {item.summary && (
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-secondary">
            {item.summary}
          </p>
        )}

        <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-tertiary">
          <span>{item.publisher}</span>
          <span>·</span>
          <span>{relativeAge(item.publishedAt)}</span>
          {item.category && (
            <>
              <span>·</span>
              <span className="truncate">{item.category}</span>
            </>
          )}
        </div>
      </div>

      <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
    </a>
  );
}
