'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, Hash, AlertTriangle, TrendingUp } from 'lucide-react';
import { clientsApi, parseApiError } from '@/lib/clients.api';
import { transactionsApi } from '@/lib/transactions.api';
import { formatCurrency, cn } from '@/lib/utils';
import {
  Client,
  Transaction,
  TransactionType,
  UpdateTransactionInput,
} from '@/types';
import { usePageHeading } from '@/components/layout/PageHeaderContext';
import { useMarket } from '@/components/layout/MarketContext';
import {
  Card,
  CardHeader,
  Input,
  Select,
  Textarea,
  Button,
  Skeleton,
  useToast,
} from '@/components/ui';

/**
 * The types an operator may correct a row to.
 *
 * The same list the ledger already stores. Changing a BUY to a SELL is a real
 * correction — a fill booked on the wrong side — and refusing it would only
 * push the operator to delete and re-enter, which loses the row's history.
 */
const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: 'buy', label: 'Buy' },
  { value: 'sell', label: 'Sell' },
  { value: 'dividend', label: 'Dividend' },
  { value: 'split', label: 'Split' },
  { value: 'bonus', label: 'Bonus' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'cash_deposit', label: 'Deposit' },
  { value: 'cash_withdrawal', label: 'Withdrawal' },
  { value: 'fees', label: 'Fees' },
];

/** Today in the yyyy-mm-dd shape a date input expects, in local time. */
const today = () => {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60_000).toISOString().slice(0, 10);
};

/** A stored date rendered for `<input type="date">`, in the date's own UTC day. */
const toDateInput = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/** Empty string -> null (clear the column); otherwise the trimmed text. */
const orNull = (v: string) => {
  const t = v.trim();
  return t === '' ? null : t;
};

export default function EditTransactionPage() {
  return (
    <Suspense fallback={null}>
      <EditTransactionPageInner />
    </Suspense>
  );
}

function EditTransactionPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const { toast } = useToast();
  const { meta } = useMarket();
  const currency = meta.currency;

  usePageHeading({
    title: 'Edit Transaction',
    subtitle: `Correct a ledger entry · ${meta.label} book`,
  });

  // The row as STORED. Every diff below is against this, so it is replaced only
  // by what the server confirms — never by the form's own values.
  const [original, setOriginal] = useState<Transaction | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [loadingRow, setLoadingRow] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [type, setType] = useState<TransactionType>('buy');
  const [ticker, setTicker] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  /** Seed the form from a stored row. Shared by the initial load and by a save. */
  const seed = (tx: Transaction) => {
    setType(tx.type);
    setTicker(tx.ticker ?? '');
    setQuantity(tx.quantity != null ? String(tx.quantity) : '');
    setPrice(tx.price != null ? String(tx.price) : '');
    setAmount(String(tx.amount));
    setDate(toDateInput(tx.date));
    setDescription(tx.description ?? '');
    setReference(tx.reference ?? '');
  };

  // Loaded by id from the URL rather than handed in through state: this page has
  // to survive a refresh and a pasted link, neither of which carries a row.
  useEffect(() => {
    if (!id) {
      setLoadingRow(false);
      setNotFound(true);
      return;
    }

    (async () => {
      try {
        const tx = await transactionsApi.get(id);
        // The backend answers null for a row that is absent OR in another
        // manager's book — deliberately indistinguishable.
        if (!tx) {
          setNotFound(true);
          return;
        }
        setOriginal(tx);
        seed(tx);

        // The owning client, for the name and — more importantly — the
        // accounting method that decides whether this row drives a return.
        try {
          setClient(await clientsApi.get(tx.clientId));
        } catch {
          // A missing client is not fatal: the correction is still valid, the
          // form just cannot promise which return moves.
          setClient(null);
        }
      } catch {
        setNotFound(true);
        toast({ tone: 'error', title: 'Failed to load transaction' });
      } finally {
        setLoadingRow(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /** Cash rows have no instrument, no share count and no per-share price. */
  const isCashRow = type === 'cash_deposit' || type === 'cash_withdrawal';

  /**
   * Does this row drive its client's XIRR? Mirrors `isFlowRow` on the
   * transactions list and `buildFlows` on the backend — transactional clients
   * are driven by buys and sells, cash-flow clients by deposits and withdrawals.
   */
  const affectsReturn = useMemo(() => {
    const method = client?.accountingMethod;
    if (method === 'transactional') return type === 'buy' || type === 'sell';
    if (method === 'cash_flow') return isCashRow;
    return false;
  }, [client?.accountingMethod, type, isCashRow]);

  /** The fields the operator actually changed, as the PATCH body. */
  const patch = useMemo<UpdateTransactionInput>(() => {
    if (!original) return {};
    const body: UpdateTransactionInput = {};

    if (type !== original.type) body.type = type;

    const nextTicker = isCashRow ? null : orNull(ticker.toUpperCase());
    if (nextTicker !== (original.ticker ?? null)) body.ticker = nextTicker;

    const nextQty = isCashRow || quantity.trim() === '' ? null : Number(quantity);
    if (nextQty !== (original.quantity ?? null)) body.quantity = nextQty;

    const nextPrice = isCashRow || price.trim() === '' ? null : Number(price);
    if (nextPrice !== (original.price ?? null)) body.price = nextPrice;

    if (amount.trim() !== '' && Number(amount) !== original.amount)
      body.amount = Number(amount);

    // Compared as calendar days, not instants: the stored value carries a time
    // the input never showed, so an instant comparison would call every save a
    // date change and re-stamp the row at midday.
    if (date && date !== toDateInput(original.date))
      body.date = new Date(`${date}T12:00:00Z`).toISOString();

    const nextDesc = orNull(description);
    if (nextDesc !== (original.description ?? null)) body.description = nextDesc;

    const nextRef = orNull(reference);
    if (nextRef !== (original.reference ?? null)) body.reference = nextRef;

    return body;
  }, [
    original,
    type,
    ticker,
    quantity,
    price,
    amount,
    date,
    description,
    reference,
    isCashRow,
  ]);

  const changedCount = Object.keys(patch).length;

  /**
   * quantity x price against the amount that settled. A prompt only: fees and
   * taxes make a legitimate gap, so this never blocks the save.
   */
  const implied = useMemo(() => {
    if (isCashRow) return null;
    const q = Number(quantity);
    const p = Number(price);
    if (!q || !p) return null;
    return q * p;
  }, [isCashRow, quantity, price]);

  /** A gap wider than rounding between the implied cost and the amount typed. */
  const impliedGap = useMemo(() => {
    const a = Number(amount);
    if (implied === null || !a) return null;
    // A tenth of a percent absorbs rounding; anything wider is worth a look.
    if (Math.abs(implied - a) <= Math.abs(a) * 0.001) return null;
    return implied - a;
  }, [implied, amount]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!original || !id) return;

    const err: Record<string, string> = {};
    const value = Number(amount);

    if (!amount.trim()) err.amount = 'Amount is required';
    else if (!Number.isFinite(value)) err.amount = 'Amount must be a number';
    if (!date) err.date = 'Date is required';
    else if (new Date(`${date}T12:00:00Z`).getTime() > Date.now())
      // Mirrors the backend's IsNotFutureDate. A forward-dated row is excluded
      // from every performance window while still showing in holdings.
      err.date = 'Date cannot be in the future';
    if (!isCashRow && !ticker.trim()) err.ticker = 'Instrument is required';
    if (quantity.trim() && !Number.isFinite(Number(quantity)))
      err.quantity = 'Quantity must be a number';
    if (price.trim() && !Number.isFinite(Number(price)))
      err.price = 'Price must be a number';

    setErrors(err);
    if (Object.keys(err).length > 0) return;

    if (changedCount === 0) {
      router.push('/transactions');
      return;
    }

    setSaving(true);
    try {
      const updated = await transactionsApi.update(id, patch);
      // Re-seed from the SERVER's copy: it normalises the ticker's casing and
      // the date, so leaving the form on its own values would show something
      // subtly different from what was stored.
      setOriginal(updated);
      seed(updated);

      toast({
        tone: 'success',
        title: 'Transaction updated',
        description: affectsReturn
          ? `${client?.name ?? 'The client'}'s return is recalculated on the next read.`
          : undefined,
      });
      setTimeout(() => router.push('/transactions'), 600);
    } catch (e2) {
      const { message, fields } = parseApiError(e2);
      setErrors(fields);
      toast({ tone: 'error', title: 'Could not update transaction', description: message });
      setSaving(false);
    }
  };

  const back = (
    <button
      onClick={() => router.push('/transactions')}
      className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink"
    >
      <ArrowLeft className="h-4 w-4" /> Back
    </button>
  );

  if (loadingRow) {
    return (
      <>
        {back}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Skeleton className="h-96 w-full" />
          </div>
          <Skeleton className="h-64 w-full lg:col-span-1" />
        </div>
      </>
    );
  }

  if (notFound || !original) {
    return (
      <>
        {back}
        <Card>
          <p className="text-[13px] text-ink-secondary">
            This transaction could not be found. It may have been deleted, or it belongs to
            another manager&apos;s book.
          </p>
        </Card>
      </>
    );
  }

  return (
    <>
      {back}

      <form onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Entry" subtitle="Instrument and account assignment" />
            <div className="mt-6 space-y-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {/*
                  Read-only rather than absent: the operator must be able to see
                  WHICH book they are correcting before changing a figure in it.
                  Re-pointing a row at another client would take a flow out of
                  one XIRR and put it into another in a single save, with neither
                  number on screen — the backend refuses it too.
                */}
                <Input
                  label="Client Account"
                  value={client?.name ?? 'Unknown client'}
                  readOnly
                  disabled
                  helper="Move an entry between clients by deleting and re-recording it"
                />

                <Input
                  label="Trade Date"
                  required
                  type="date"
                  max={today()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  error={errors.date}
                  helper="When the trade happened — drives XIRR"
                />
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Select
                  label="Type"
                  required
                  value={type}
                  onChange={(e) => setType(e.target.value as TransactionType)}
                  error={errors.type}
                >
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>

                {!isCashRow && (
                  <Input
                    label="Ticker"
                    required
                    placeholder="ICICIBANK.NS"
                    leftIcon={<Hash className="h-4 w-4" />}
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value.toUpperCase())}
                    error={errors.ticker}
                    className="uppercase"
                    autoComplete="off"
                  />
                )}
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                {!isCashRow && (
                  <>
                    <Input
                      label="Quantity"
                      type="number"
                      step="any"
                      min="0"
                      placeholder="100"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      error={errors.quantity}
                    />
                    <Input
                      label="Price"
                      type="number"
                      step="any"
                      min="0"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      error={errors.price}
                      rightAddon={<span className="text-xs text-ink-tertiary">{currency}</span>}
                      helper="Per share"
                    />
                  </>
                )}
                <Input
                  label="Amount"
                  required
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  error={errors.amount}
                  rightAddon={<span className="text-xs text-ink-tertiary">{currency}</span>}
                  helper={isCashRow ? 'Cash moved' : 'Net of brokerage and taxes'}
                />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Audit" subtitle="Why this entry was corrected" />
            <div className="mt-6 space-y-5">
              <Textarea
                label="Notes"
                placeholder="Corrected from the contract note…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                error={errors.description}
                rows={3}
              />
              <Input
                label="Reference"
                placeholder="Contract note number"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                error={errors.reference}
              />
            </div>
          </Card>
        </div>

        {/* Live preview — what this save will actually change. */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 space-y-6">
            <Card>
              <CardHeader
                title="Pending Changes"
                subtitle="Only these fields are saved"
                action={
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide',
                      changedCount === 0
                        ? 'bg-surface-3 text-ink-tertiary'
                        : 'bg-brand-soft text-brand'
                    )}
                  >
                    {changedCount === 0 ? 'None' : `${changedCount} edited`}
                  </span>
                }
              />

              <div className="mt-5 space-y-4">
                {changedCount === 0 ? (
                  <p className="text-[13px] leading-relaxed text-ink-secondary">
                    Nothing has changed yet. Edit a field and the old and new values appear
                    here before you save.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {/*
                      Old -> new for every changed field. A ledger correction is
                      worth showing back to the operator before it is written —
                      a mistyped amount looks identical to a correct one in the
                      input, but not next to the figure it replaces.
                    */}
                    {Object.keys(patch).map((k) => (
                      <ChangeRow
                        key={k}
                        field={k}
                        before={original[k as keyof Transaction]}
                        after={patch[k as keyof UpdateTransactionInput]}
                        currency={currency}
                      />
                    ))}
                  </div>
                )}

                {affectsReturn && (
                  <div className="flex gap-3 rounded-[12px] border border-warning/30 bg-warning/10 p-3.5">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <p className="text-[13px] leading-relaxed text-ink-secondary">
                      <span className="font-medium text-ink">This entry drives a return.</span>{' '}
                      Changing its amount or date moves the XIRR reported for{' '}
                      {client?.name ?? 'this client'} on the Performance screen.
                    </p>
                  </div>
                )}

                {impliedGap !== null && (
                  <>
                    <div className="h-px bg-border" />
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-ink-secondary">Quantity × Price</span>
                      <span className="text-[13px] tabular-nums text-ink">
                        {formatCurrency(implied ?? 0, currency)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] text-ink-secondary">Against amount</span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                          'bg-surface-3 text-ink-secondary'
                        )}
                      >
                        <TrendingUp className="h-3 w-3" />
                        {formatCurrency(Math.abs(impliedGap), currency)} apart
                      </span>
                    </div>
                    <p className="text-[12px] leading-relaxed text-ink-tertiary">
                      Expected when the amount includes brokerage and taxes — it is saved
                      exactly as typed, never recomputed.
                    </p>
                  </>
                )}
              </div>
            </Card>

            <div className="flex flex-col gap-3">
              <Button
                type="submit"
                loading={saving}
                disabled={changedCount === 0}
                leftIcon={<Check className="h-4 w-4" />}
                className="w-full"
              >
                {changedCount === 0
                  ? 'No changes'
                  : `Save ${changedCount} change${changedCount === 1 ? '' : 's'}`}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/transactions')}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}

const FIELD_LABELS: Record<string, string> = {
  type: 'Type',
  ticker: 'Instrument',
  quantity: 'Quantity',
  price: 'Price',
  amount: 'Amount',
  date: 'Date',
  description: 'Notes',
  reference: 'Reference',
};

/** One field's old and new value, side by side. */
function ChangeRow({
  field,
  before,
  after,
  currency,
}: {
  field: string;
  before: unknown;
  after: unknown;
  currency: string;
}) {
  const show = (v: unknown) => {
    if (v === null || v === undefined || v === '') return '—';
    if (field === 'amount' || field === 'price')
      return formatCurrency(Number(v), currency);
    if (field === 'date')
      return new Date(String(v)).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    if (field === 'type') {
      const opt = TYPE_OPTIONS.find((o) => o.value === v);
      return opt ? opt.label : String(v);
    }
    if (field === 'quantity') return Number(v).toLocaleString();
    return String(v);
  };

  return (
    <div className="rounded-[10px] bg-surface-2 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
        {FIELD_LABELS[field] ?? field}
      </p>
      <div className="mt-1 flex items-center gap-2 text-[13px]">
        <span className="truncate text-ink-tertiary line-through">{show(before)}</span>
        <span className="text-ink-tertiary">→</span>
        <span className="truncate font-semibold tabular-nums text-ink">{show(after)}</span>
      </div>
    </div>
  );
}
