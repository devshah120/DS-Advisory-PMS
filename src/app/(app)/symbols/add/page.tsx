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
import { Client, Holding } from '@/types';
import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPct,
  cn,
} from '@/lib/utils';
import { usePageHeading } from '@/components/layout/PageHeaderContext';
import { useMarket } from '@/components/layout/MarketContext';
import { displayTicker } from '@/lib/market-scope';
import { Card, CardHeader, Input, Select, Button, useToast } from '@/components/ui';

/** Today in the yyyy-mm-dd shape a date input expects, in local time. */
const today = () => {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60_000).toISOString().slice(0, 10);
};

const initial = {
  side: 'buy' as 'buy' | 'sell',
  clientId: '',
  tradeDate: today(),
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
  // The book decides how a bare ticker resolves — "RELIANCE" is only a valid
  // symbol under the Indian book, where it qualifies to RELIANCE.NS.
  const { market, meta } = useMarket();
  // Every preview figure on this form — proceeds, basis, realised P&L — is in
  // the book's currency, so an Indian position previews in rupees.
  const currency = meta.currency;

  usePageHeading({
    title: 'Add Position',
    subtitle: `Record a new holding for a client account · ${meta.label} book`,
  });

  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(initial);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [status, setStatus] = useState<LookupStatus>('idle');
  const [resolved, setResolved] = useState<
    { company: string; exchange: string; symbol: string } | null
  >(null);

  // The client's open lot in this ticker, when they have one. A sell is a
  // disposal out of THIS position, so its P&L can only be measured against the
  // basis recorded here — without it there is nothing to realise a gain against.
  const [openLot, setOpenLot] = useState<Holding | null>(null);
  const [lotLoading, setLotLoading] = useState(false);

  // Fields the user edited by hand. The lookup leaves these alone so an
  // in-flight response can't overwrite something typed while it was pending.
  const touched = useRef<Set<string>>(new Set());
  const inflight = useRef<AbortController | null>(null);

  // Only the selected book's clients are offered, so a position can't be filed
  // against a mandate from the other book.
  useEffect(() => {
    apiClient
      .getClient()
      .get('/clients', { params: { market } })
      .then((r) => setClients(r.data.data || r.data))
      .catch(() => {});
  }, [market]);

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
      const data = await marketApi.lookup(ticker, market, controller.signal);
      if (controller.signal.aborted) return;

      setForm((prev) => {
        // A later keystroke may have changed the ticker while this was in
        // flight. Compare against BOTH forms of the resolved symbol: under the
        // Indian book the user typed "RELIANCE" while the server answers
        // "RELIANCE.NS", and matching only the qualified form would discard
        // every Indian lookup as stale.
        const typed = prev.ticker.trim().toUpperCase();
        if (typed !== data.ticker && typed !== data.displayTicker) return prev;

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
      // `symbol` is the fully-qualified form the position must be SAVED under —
      // an Indian holding stored as "RELIANCE" instead of "RELIANCE.NS" would
      // never resolve a price again.
      setResolved({ company: data.company, exchange: data.exchange, symbol: data.ticker });
      setStatus('found');
    } catch (err) {
      if (controller.signal.aborted) return;
      setResolved(null);
      setStatus(err instanceof SymbolNotFoundError ? 'notfound' : 'error');
    }
  }, [market]);

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

  // Look up the client's open lot in this ticker. Runs for buys as well as
  // sells: a buy into an existing position is averaged into it server-side, and
  // showing the resulting blended basis beats letting it surprise the user
  // after the fact.
  useEffect(() => {
    const ticker = form.ticker.trim().toUpperCase();
    if (!form.clientId || !ticker) {
      setOpenLot(null);
      return;
    }

    let cancelled = false;
    setLotLoading(true);

    apiClient
      .getClient()
      .get<Holding[]>(`/holdings/client/${form.clientId}`)
      .then((r) => {
        if (cancelled) return;
        const rows = Array.isArray(r.data) ? r.data : [];
        // Holdings are stored fully qualified, so a typed "RELIANCE" has to be
        // matched against the stored "RELIANCE.NS" too — otherwise a sell into
        // an existing Indian lot would find nothing and be rejected as having
        // no open position.
        const match = rows.find(
          (h) =>
            h.quantity > 0 &&
            (h.ticker?.toUpperCase() === ticker ||
              displayTicker(h.ticker ?? '') === ticker),
        );
        setOpenLot(match ?? null);
      })
      .catch(() => {
        if (!cancelled) setOpenLot(null);
      })
      .finally(() => {
        if (!cancelled) setLotLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [form.clientId, form.ticker]);

  const qty = parseFloat(form.quantity) || 0;
  const amountInvested = parseFloat(form.amountInvested) || 0;
  const price = parseFloat(form.currentPrice) || 0;
  const isSell = form.side === 'sell';

  /**
   * Fills the ticket to close the position out completely.
   *
   * Quantity is copied from the lot verbatim rather than rounded — a lot of
   * 46.414 shares only closes to exactly zero if all 46.414 are sold, and a
   * tidied 46.41 would leave a fractional stub behind that still renders as an
   * open position.
   *
   * Proceeds are seeded at the current price because the field is required and
   * a market exit is the common case; the user can still overwrite it with the
   * actual fill before submitting, which is why this is a starting point rather
   * than a locked value.
   */
  const sellAll = () => {
    if (!openLot) return;
    set('quantity', String(openLot.quantity));
    const atPrice = price > 0 ? price : openLot.currentPrice;
    if (atPrice > 0) {
      // toFixed(2) matches the field's own step, so the seeded figure is one
      // the user could have typed themselves.
      set('amountInvested', (openLot.quantity * atPrice).toFixed(2));
    }
  };

  /** True when the ticket already closes the whole lot, within float dust. */
  const isFullExit =
    isSell && openLot != null && qty > 0 && Math.abs(openLot.quantity - qty) < 1e-9;

  // On a buy this is the cost of the shares acquired. On a sell it is the gross
  // proceeds, so it must never be divided into a per-share "cost" — the basis of
  // sold shares comes from the lot being sold, not from this trade.
  const avgCost = !isSell && qty > 0 ? amountInvested / qty : 0;

  /**
   * What a sell actually does, in the terms the accounting works in.
   *
   * Proceeds are what the sale brings in (quantity x sale price). The basis
   * given up is that same quantity at the lot's average cost. The difference is
   * REALISED — the shares are gone, so nothing about this trade is unrealised.
   * Anything left in the lot keeps its original basis and stays unrealised,
   * which is what the "Remaining" figures below describe.
   */
  const preview = useMemo(() => {
    if (isSell) {
      const basisPerShare = openLot?.averageCost ?? 0;
      // Proceeds follow the amount the user actually entered; the sale price is
      // only the fallback when they have not typed an amount yet.
      const proceeds = amountInvested > 0 ? amountInvested : qty * price;
      const costOfSold = basisPerShare * qty;
      const realized = proceeds - costOfSold;
      const pct = costOfSold ? (realized / costOfSold) * 100 : 0;

      const heldQty = openLot?.quantity ?? 0;
      const remainingQty = heldQty - qty;
      const oversold = openLot != null && remainingQty < 0;

      return {
        proceeds,
        costOfSold,
        basisPerShare,
        realized,
        pct,
        heldQty,
        remainingQty,
        oversold,
        // The unsold balance, still marked against the live price.
        remainingValue: remainingQty > 0 ? remainingQty * price : 0,
        remainingUnrealized:
          remainingQty > 0 ? (price - basisPerShare) * remainingQty : 0,
        salePrice: qty > 0 ? proceeds / qty : 0,
      };
    }

    const marketValue = qty * price;
    const cost = amountInvested;
    const pnl = marketValue - cost;
    const pct = cost ? (pnl / cost) * 100 : 0;
    return { marketValue, cost, pnl, pct };
  }, [qty, amountInvested, price, isSell, openLot]);

  // Narrowed views so the JSX below can read either shape without casts.
  const sellView = isSell ? (preview as Extract<typeof preview, { realized: number }>) : null;
  const buyView = !isSell ? (preview as Extract<typeof preview, { marketValue: number }>) : null;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.clientId) e.clientId = 'Select a client';
    if (!form.tradeDate) e.tradeDate = 'Enter the trade date';
    else if (new Date(`${form.tradeDate}T00:00:00`) > new Date()) {
      e.tradeDate = 'Trade date cannot be in the future';
    }
    if (!form.ticker.trim()) e.ticker = 'Ticker is required';
    else if (status === 'notfound') e.ticker = 'Unknown ticker';
    if (!form.company.trim()) e.company = 'Company name is required';
    if (qty <= 0) e.quantity = 'Enter a quantity';
    if (amountInvested <= 0) {
      e.amountInvested = isSell ? 'Enter the sale proceeds' : 'Enter the amount invested';
    }
    if (price <= 0) e.currentPrice = 'Enter current price';

    // A sell has to come out of something. Catching it here keeps the user from
    // losing the form to a 400 the server would raise for the same reason.
    if (isSell && form.clientId && form.ticker.trim() && !lotLoading) {
      if (!openLot) {
        e.ticker = 'This client holds no open position in this ticker';
      } else if (qty - openLot.quantity > 1e-9) {
        // Tolerance rather than a bare `>`: "Sell All" fills the quantity from
        // the lot itself, and a strict comparison can reject that exact figure
        // on float dust alone.
        e.quantity = `Only ${openLot.quantity} shares held`;
      }
    }
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
        // The RESOLVED symbol, so an Indian position is stored fully qualified
        // ('RELIANCE.NS') and stays priceable. Falls back to what was typed when
        // no lookup succeeded — the same behaviour as before this book existed.
        ticker: resolved?.symbol ?? form.ticker.trim().toUpperCase(),
        company: form.company.trim(),
        sector: form.sector.trim(),
        industry: form.industry.trim(),
        country: form.country.trim(),
        theme: form.theme.trim(),
        exchange: form.exchange.trim(),
        quantity: isSell ? -qty : qty,
        // On a sell the basis of the shares leaving is the lot's average cost —
        // proceeds divided by quantity would overwrite the basis with the sale
        // price and silently erase the gain being realised.
        averageCost: isSell ? (openLot?.averageCost ?? 0) : avgCost,
        // The price the sale actually executed at, derived from the proceeds
        // entered rather than the last close, so realised P&L matches the ticket.
        currentPrice: isSell && qty > 0 ? amountInvested / qty : price,
        // Dates the ledger row this creates. XIRR weights flows by date, so a
        // back-dated trade has to carry its own date rather than land on today.
        date: new Date(`${form.tradeDate}T00:00:00`).toISOString(),
        amountInvested,
      });
      toast({
        tone: 'success',
        title: isSell ? 'Sell recorded' : 'Position added',
        description: sellView
          ? `${form.ticker.toUpperCase()} — ${formatCurrency(sellView.proceeds, currency)} proceeds, ${formatSignedCurrency(sellView.realized, currency)} realised.`
          : `${form.ticker.toUpperCase()} buy saved.`,
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
    <>
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

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
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

                <Input
                  label="Trade Date"
                  required
                  type="date"
                  max={today()}
                  value={form.tradeDate}
                  onChange={(e) => set('tradeDate', e.target.value)}
                  error={errors.tradeDate}
                  helper="When the trade happened — drives XIRR"
                />
              </div>

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
                  // Only offered on a sell with something to sell: on a buy
                  // there is no "all" to mean anything, and with no open lot
                  // the button would have nothing to fill from.
                  rightAddon={
                    isSell && openLot && openLot.quantity > 0 ? (
                      <button
                        type="button"
                        onClick={sellAll}
                        title={`Sell the full ${openLot.quantity} shares held`}
                        className={cn(
                          'pointer-events-auto rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                          isFullExit
                            ? 'bg-danger text-white'
                            : 'bg-danger-soft text-danger hover:bg-danger hover:text-white'
                        )}
                      >
                        All
                      </button>
                    ) : undefined
                  }
                  helper={
                    isSell && openLot
                      ? isFullExit
                        ? `Closing the full ${openLot.quantity}-share position`
                        : `${openLot.quantity} shares held`
                      : undefined
                  }
                />
                <Input
                  label={isSell ? 'Sale Proceeds' : 'Amount Invested'}
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="15000.00"
                  rightAddon={currency}
                  value={form.amountInvested}
                  onChange={(e) => set('amountInvested', e.target.value)}
                  error={errors.amountInvested}
                  helper={isSell ? 'Gross amount the shares sold for' : undefined}
                />
                <Input
                  label={isSell ? 'Avg. Cost (held)' : 'Avg. Cost'}
                  readOnly
                  tabIndex={-1}
                  placeholder="—"
                  rightAddon={currency}
                  value={
                    isSell
                      ? openLot
                        ? openLot.averageCost.toFixed(2)
                        : ''
                      : avgCost > 0
                        ? avgCost.toFixed(2)
                        : ''
                  }
                  helper={
                    isSell
                      ? 'Basis of the shares being sold'
                      : 'Amount invested ÷ quantity'
                  }
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
                rightAddon={currency}
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
                title={isSell ? 'Sale Preview' : 'Position Preview'}
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

              {sellView ? (
                <div className="mt-5 space-y-4">
                  {!openLot && !lotLoading && form.clientId && form.ticker.trim() ? (
                    <p className="rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] text-danger">
                      No open position in {form.ticker.toUpperCase()} for this client — there is
                      nothing to sell against.
                    </p>
                  ) : null}

                  {sellView.oversold ? (
                    <p className="rounded-[10px] bg-danger-soft px-3 py-2 text-[13px] text-danger">
                      Selling {qty} of {sellView.heldQty} shares held.
                    </p>
                  ) : null}

                  <PreviewRow
                    label="Market Value Sold"
                    value={formatCurrency(sellView.proceeds, currency)}
                    strong
                  />
                  <PreviewRow
                    label="Sale Price"
                    value={sellView.salePrice > 0 ? formatCurrency(sellView.salePrice, currency) : '—'}
                  />
                  <PreviewRow
                    label="Cost of Shares Sold"
                    value={sellView.costOfSold > 0 ? formatCurrency(sellView.costOfSold, currency) : '—'}
                  />
                  <PreviewRow
                    label="Avg. Cost (held)"
                    value={
                      sellView.basisPerShare > 0 ? formatCurrency(sellView.basisPerShare, currency) : '—'
                    }
                  />

                  <div className="h-px bg-border" />

                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-ink">Realized P&amp;L</span>
                    <span
                      className={cn(
                        'text-sm font-semibold tabular-nums',
                        sellView.realized >= 0 ? 'text-success' : 'text-danger'
                      )}
                    >
                      {formatSignedCurrency(sellView.realized, currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-ink-secondary">Return on Cost</span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                        sellView.pct >= 0
                          ? 'bg-success-soft text-success'
                          : 'bg-danger-soft text-danger'
                      )}
                    >
                      <TrendingUp className="h-3 w-3" />
                      {formatSignedPct(sellView.pct)}
                    </span>
                  </div>

                  {openLot && !sellView.oversold ? (
                    <>
                      <div className="h-px bg-border" />
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
                        After this trade
                      </p>
                      <PreviewRow
                        label="Shares Remaining"
                        value={`${+sellView.remainingQty.toFixed(4)}`}
                      />
                      <PreviewRow
                        label="Remaining Value"
                        value={
                          sellView.remainingQty > 0
                            ? formatCurrency(sellView.remainingValue, currency)
                            : formatCurrency(0, currency)
                        }
                      />
                      {sellView.remainingQty > 0 ? (
                        <div className="flex items-center justify-between">
                          <span className="text-[13px] text-ink-secondary">
                            Unrealized P&amp;L
                          </span>
                          <span
                            className={cn(
                              'text-sm font-semibold tabular-nums',
                              sellView.remainingUnrealized >= 0 ? 'text-success' : 'text-danger'
                            )}
                          >
                            {formatSignedCurrency(sellView.remainingUnrealized, currency)}
                          </span>
                        </div>
                      ) : (
                        <p className="text-[12px] text-ink-tertiary">
                          Position fully closed.
                        </p>
                      )}
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  <PreviewRow
                    label="Market Value"
                    value={formatCurrency(buyView?.marketValue ?? 0, currency)}
                    strong
                  />
                  <PreviewRow
                    label="Amount Invested"
                    value={formatCurrency(buyView?.cost ?? 0, currency)}
                  />
                  <PreviewRow label="Avg. Cost" value={avgCost > 0 ? formatCurrency(avgCost, currency) : '—'} />

                  {openLot ? (
                    <p className="rounded-[10px] bg-surface-2 px-3 py-2 text-[12px] text-ink-secondary">
                      Adding to an existing {openLot.quantity}-share position at{' '}
                      {formatCurrency(openLot.averageCost, currency)} — the basis will be averaged.
                    </p>
                  ) : null}

                  <div className="h-px bg-border" />
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-ink-secondary">Unrealized P&L</span>
                    <span
                      className={cn(
                        'text-sm font-semibold tabular-nums',
                        (buyView?.pnl ?? 0) >= 0 ? 'text-success' : 'text-danger'
                      )}
                    >
                      {formatSignedCurrency(buyView?.pnl ?? 0, currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] text-ink-secondary">Return</span>
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                        (buyView?.pct ?? 0) >= 0
                          ? 'bg-success-soft text-success'
                          : 'bg-danger-soft text-danger'
                      )}
                    >
                      <TrendingUp className="h-3 w-3" />
                      {formatSignedPct(buyView?.pct ?? 0)}
                    </span>
                  </div>
                </div>
              )}
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
    </>
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
