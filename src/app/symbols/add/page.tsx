'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  TrendingUp,
  Hash,
  Building2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { apiClient } from '@/lib/api';
import { marketApi, SymbolNotFoundError } from '@/lib/market.api';
import { Client } from '@/types';
import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPct,
  cn,
} from '@/lib/utils';
import AppShell from '@/components/layout/AppShell';
import { Card, CardHeader, Input, Select, Button, useToast } from '@/components/ui';

const initial = {
  side: 'buy' as 'buy' | 'sell',
  clientId: '',
  ticker: '',
  company: '',
  quantity: '',
  amountInvested: '',
  currentPrice: '',
  sector: '',
  industry: '',
  country: '',
  theme: '',
  exchange: '',
};

type FormState = typeof initial;

/** Fields the ticker lookup fills in; it never clobbers one the user has typed into. */
const AUTOFILLED = [
  'company',
  'sector',
  'industry',
  'country',
  'theme',
  'exchange',
  'currentPrice',
] as const;

type LookupStatus = 'idle' | 'loading' | 'found' | 'notfound' | 'error';

const DEBOUNCE_MS = 500;

export default function AddSymbolPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(initial);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [status, setStatus] = useState<LookupStatus>('idle');
  const [resolved, setResolved] = useState<{ company: string; exchange: string } | null>(null);

  // Fields the user edited by hand. The lookup leaves these alone so an
  // in-flight response can't overwrite something typed while it was pending.
  const touched = useRef<Set<string>>(new Set());
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => {
    apiClient
      .getClient()
      .get('/clients')
      .then((r) => setClients(r.data.data || r.data))
      .catch(() => {});
  }, []);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: '' }));
  };

  // Manual edits to an autofilled field opt it out of future lookups.
  const setManual = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    touched.current.add(k);
    set(k, v);
  };

  const runLookup = useCallback(async (ticker: string) => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;

    setStatus('loading');
    try {
      const data = await marketApi.lookup(ticker, controller.signal);
      if (controller.signal.aborted) return;

      setForm((prev) => {
        // A later keystroke may have changed the ticker while this was in flight.
        if (prev.ticker.trim().toUpperCase() !== data.ticker) return prev;

        const next = { ...prev };
        for (const field of AUTOFILLED) {
          if (touched.current.has(field)) continue;
          const value =
            field === 'currentPrice'
              ? data.currentPrice != null
                ? String(data.currentPrice)
                : ''
              : (data[field] ?? '');
          if (value) next[field] = value;
        }
        return next;
      });

      setErrors((e) => ({ ...e, ticker: '', company: '' }));
      setResolved({ company: data.company, exchange: data.exchange });
      setStatus('found');
    } catch (err) {
      if (controller.signal.aborted) return;
      setResolved(null);
      setStatus(err instanceof SymbolNotFoundError ? 'notfound' : 'error');
    }
  }, []);

  // Debounce so a fast typist doesn't fire a request per keystroke.
  useEffect(() => {
    const ticker = form.ticker.trim().toUpperCase();
    if (ticker.length < 1) {
      inflight.current?.abort();
      setStatus('idle');
      setResolved(null);
      return;
    }
    const id = setTimeout(() => runLookup(ticker), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [form.ticker, runLookup]);

  useEffect(() => () => inflight.current?.abort(), []);

  const qty = parseFloat(form.quantity) || 0;
  const amountInvested = parseFloat(form.amountInvested) || 0;
  const price = parseFloat(form.currentPrice) || 0;
  const isSell = form.side === 'sell';

  // Avg. Cost is always derived, never entered.
  const avgCost = qty > 0 ? amountInvested / qty : 0;

  const preview = useMemo(() => {
    const marketValue = qty * price;
    const cost = amountInvested;
    // For a sell (short), P&L moves inversely to price.
    const pnl = isSell ? cost - marketValue : marketValue - cost;
    const pct = cost ? (pnl / cost) * 100 : 0;
    return { marketValue, cost, pnl, pct };
  }, [qty, amountInvested, price, isSell]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.clientId) e.clientId = 'Select a client';
    if (!form.ticker.trim()) e.ticker = 'Ticker is required';
    else if (status === 'notfound') e.ticker = 'Unknown ticker';
    if (!form.company.trim()) e.company = 'Company name is required';
    if (qty <= 0) e.quantity = 'Enter a quantity';
    if (amountInvested <= 0) e.amountInvested = 'Enter the amount invested';
    if (price <= 0) e.currentPrice = 'Enter current price';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      // Only the keys CreateHoldingDto accepts — the API rejects unknown fields.
      // marketValue and unrealizedPnL are derived server-side; a buy into an
      // existing ticker is averaged into it there.
      await apiClient.getClient().post('/holdings', {
        clientId: form.clientId,
        ticker: form.ticker.trim().toUpperCase(),
        company: form.company.trim(),
        sector: form.sector.trim(),
        industry: form.industry.trim(),
        country: form.country.trim(),
        theme: form.theme.trim(),
        exchange: form.exchange.trim(),
        quantity: isSell ? -qty : qty,
        averageCost: avgCost,
        currentPrice: price,
      });
      toast({
        tone: 'success',
        title: isSell ? 'Sell recorded' : 'Position added',
        description: `${form.ticker.toUpperCase()} ${isSell ? 'sell' : 'buy'} saved.`,
      });
      setTimeout(() => router.push('/holdings'), 800);
    } catch {
      toast({ tone: 'error', title: 'Could not add position' });
      setLoading(false);
    }
  };

  const tickerHelper =
    status === 'loading'
      ? 'Looking up symbol…'
      : status === 'found' && resolved
        ? `${resolved.company}${resolved.exchange ? ` · ${resolved.exchange}` : ''}`
        : status === 'error'
          ? 'Lookup unavailable — enter details manually'
          : undefined;

  return (
    <AppShell title="Add Position" subtitle="Record a new holding for a client account">
      <button
        onClick={() => router.back()}
        className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <form onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Position" subtitle="Instrument and account assignment" />
            <div className="mt-6 space-y-5">
              <div className="space-y-1.5">
                <span className="block text-[13px] font-medium text-ink">Side</span>
                <div className="grid grid-cols-2 gap-2 rounded-[12px] border border-border bg-surface-2 p-1">
                  {(['buy', 'sell'] as const).map((s) => {
                    const active = form.side === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => set('side', s)}
                        className={cn(
                          'flex h-9 items-center justify-center rounded-[9px] text-[13px] font-semibold capitalize transition-colors',
                          active
                            ? s === 'buy'
                              ? 'bg-success text-white shadow-sm'
                              : 'bg-danger text-white shadow-sm'
                            : 'text-ink-secondary hover:text-ink'
                        )}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Select
                label="Client Account"
                required
                value={form.clientId}
                onChange={(e) => set('clientId', e.target.value)}
                error={errors.clientId}
              >
                <option value="">Select a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Input
                  label="Ticker"
                  required
                  placeholder="AAPL"
                  leftIcon={<Hash className="h-4 w-4" />}
                  rightAddon={
                    status === 'loading' ? (
                      <Loader2 className="h-4 w-4 animate-spin text-ink-tertiary" />
                    ) : undefined
                  }
                  value={form.ticker}
                  onChange={(e) => set('ticker', e.target.value.toUpperCase())}
                  error={errors.ticker || (status === 'notfound' ? 'Unknown ticker' : undefined)}
                  success={status === 'found' ? tickerHelper : undefined}
                  helper={status === 'found' ? undefined : tickerHelper}
                  className="uppercase"
                  autoComplete="off"
                />
                <Input
                  label="Company"
                  required
                  placeholder="Apple Inc."
                  leftIcon={<Building2 className="h-4 w-4" />}
                  value={form.company}
                  onChange={(e) => setManual('company', e.target.value)}
                  error={errors.company}
                />
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                <Input
                  label="Quantity"
                  required
                  type="number"
                  step="any"
                  min="0"
                  placeholder="100"
                  value={form.quantity}
                  onChange={(e) => set('quantity', e.target.value)}
                  error={errors.quantity}
                />
                <Input
                  label="Amount Invested"
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="15000.00"
                  rightAddon="USD"
                  value={form.amountInvested}
                  onChange={(e) => set('amountInvested', e.target.value)}
                  error={errors.amountInvested}
                />
                <Input
                  label="Avg. Cost"
                  readOnly
                  tabIndex={-1}
                  placeholder="—"
                  rightAddon="USD"
                  value={avgCost > 0 ? avgCost.toFixed(2) : ''}
                  helper="Amount invested ÷ quantity"
                  className="cursor-default bg-surface-2"
                />
              </div>

              <Input
                label="Current Price"
                required
                type="number"
                step="0.01"
                min="0"
                placeholder="175.00"
                rightAddon="USD"
                value={form.currentPrice}
                onChange={(e) => setManual('currentPrice', e.target.value)}
                error={errors.currentPrice}
                helper="Auto-filled from the last close; override if needed"
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Classification"
              subtitle="Auto-filled from the ticker — edit to override"
              action={
                form.ticker.trim() ? (
                  <button
                    type="button"
                    onClick={() => {
                      AUTOFILLED.forEach((f) => touched.current.delete(f));
                      runLookup(form.ticker.trim().toUpperCase());
                    }}
                    disabled={status === 'loading'}
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink disabled:opacity-50"
                  >
                    <RefreshCw className={cn('h-3.5 w-3.5', status === 'loading' && 'animate-spin')} />
                    Refresh
                  </button>
                ) : undefined
              }
            />
            <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
              <Input
                label="Sector"
                placeholder="Technology"
                value={form.sector}
                onChange={(e) => setManual('sector', e.target.value)}
              />
              <Input
                label="Industry"
                placeholder="Consumer Electronics"
                value={form.industry}
                onChange={(e) => setManual('industry', e.target.value)}
              />
              <Input
                label="Country"
                placeholder="United States"
                value={form.country}
                onChange={(e) => setManual('country', e.target.value)}
              />
              <Input
                label="Theme"
                placeholder="AI, Cloud…"
                value={form.theme}
                onChange={(e) => setManual('theme', e.target.value)}
              />
            </div>
          </Card>
        </div>

        {/* Live preview */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 space-y-6">
            <Card>
              <CardHeader
                title="Position Preview"
                subtitle="Calculated in real time"
                action={
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide',
                      isSell ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'
                    )}
                  >
                    {form.side}
                  </span>
                }
              />
              <div className="mt-5 space-y-4">
                <PreviewRow label="Market Value" value={formatCurrency(preview.marketValue)} strong />
                <PreviewRow label={isSell ? 'Proceeds' : 'Amount Invested'} value={formatCurrency(preview.cost)} />
                <PreviewRow label="Avg. Cost" value={avgCost > 0 ? formatCurrency(avgCost) : '—'} />
                <div className="h-px bg-border" />
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-ink-secondary">Unrealized P&L</span>
                  <span className={cn('text-sm font-semibold tabular-nums', preview.pnl >= 0 ? 'text-success' : 'text-danger')}>
                    {formatSignedCurrency(preview.pnl)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-ink-secondary">Return</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                      preview.pct >= 0 ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
                    )}
                  >
                    <TrendingUp className="h-3 w-3" />
                    {formatSignedPct(preview.pct)}
                  </span>
                </div>
              </div>
            </Card>

            <div className="flex flex-col gap-3">
              <Button
                type="submit"
                variant={isSell ? 'danger' : 'primary'}
                loading={loading}
                leftIcon={<Check className="h-4 w-4" />}
                className="w-full"
              >
                {isSell ? 'Record Sell' : 'Add Position'}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()} className="w-full">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </form>
    </AppShell>
  );
}

function PreviewRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-ink-secondary">{label}</span>
      <span className={cn('tabular-nums', strong ? 'text-base font-semibold text-ink' : 'text-[13px] text-ink')}>
        {value}
      </span>
    </div>
  );
}
