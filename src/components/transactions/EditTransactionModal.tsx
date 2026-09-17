'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { transactionsApi } from '@/lib/transactions.api';
import { parseApiError } from '@/lib/clients.api';
import { formatCurrency } from '@/lib/utils';
import {
  Client,
  Transaction,
  TransactionType,
  UpdateTransactionInput,
} from '@/types';
import { Modal, Input, Select, Textarea, Button, useToast } from '@/components/ui';

/**
 * The types an operator may correct a row to.
 *
 * The same list the ledger already stores. Changing a BUY to a SELL is a real
 * correction an operator needs — a fill booked on the wrong side — and refusing
 * it would only push them to delete and re-enter, which loses the row's history.
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

/** A stored date rendered for `<input type="date">`, in the date's own UTC day. */
const toDateInput = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

/** Empty string -> null (clear the column); otherwise the trimmed text. */
const orNull = (v: string) => {
  const t = v.trim();
  return t === '' ? null : t;
};

/**
 * Correct one ledger row.
 *
 * Three decisions worth stating, because each is a place this could have
 * quietly done the wrong thing:
 *
 *  - The client is shown but not editable. Re-pointing a row at another client
 *    takes a flow out of one XIRR and puts it into another in a single save,
 *    with neither number on screen. The backend refuses it too.
 *
 *  - Only changed fields are sent. The form diffs against the row it opened
 *    with, so a save that touched nothing is a no-op rather than a write that
 *    bumps `updatedAt` on the ledger.
 *
 *  - Amount is never re-derived from quantity x price. On an Indian book a
 *    contract's net amount carries brokerage and STT, so it is genuinely not
 *    the product of the other two; computing it would silently overwrite the
 *    figure that actually settled. The form points out a wide gap and lets the
 *    operator decide.
 */
export function EditTransactionModal({
  transaction,
  client,
  currency,
  onClose,
  onSaved,
}: {
  transaction: Transaction | null;
  client?: Client;
  currency: string;
  onClose: () => void;
  onSaved: (tx: Transaction) => void;
}) {
  const { toast } = useToast();

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

  // Re-seed whenever a different row is opened. Without the reset an operator
  // who closes one row and opens another would edit the first row's values
  // against the second row's id.
  useEffect(() => {
    if (!transaction) return;
    setType(transaction.type);
    setTicker(transaction.ticker ?? '');
    setQuantity(transaction.quantity != null ? String(transaction.quantity) : '');
    setPrice(transaction.price != null ? String(transaction.price) : '');
    setAmount(String(transaction.amount));
    setDate(toDateInput(transaction.date));
    setDescription(transaction.description ?? '');
    setReference(transaction.reference ?? '');
    setErrors({});
  }, [transaction]);

  /** Cash rows have no instrument, no share count and no per-share price. */
  const isCashRow = type === 'cash_deposit' || type === 'cash_withdrawal';

  /**
   * Does this row drive its client's XIRR? Mirrors `isFlowRow` on the page and
   * `buildFlows` on the backend — transactional clients are driven by buys and
   * sells, cash-flow clients by deposits and withdrawals.
   */
  const affectsReturn = useMemo(() => {
    const method = client?.accountingMethod;
    if (method === 'transactional') return type === 'buy' || type === 'sell';
    if (method === 'cash_flow') return isCashRow;
    return false;
  }, [client?.accountingMethod, type, isCashRow]);

  /** The fields the operator actually changed, as the PATCH body. */
  const patch = useMemo<UpdateTransactionInput>(() => {
    if (!transaction) return {};
    const body: UpdateTransactionInput = {};

    if (type !== transaction.type) body.type = type;

    const nextTicker = isCashRow ? null : orNull(ticker.toUpperCase());
    if (nextTicker !== (transaction.ticker ?? null)) body.ticker = nextTicker;

    const nextQty = isCashRow || quantity.trim() === '' ? null : Number(quantity);
    if (nextQty !== (transaction.quantity ?? null)) body.quantity = nextQty;

    const nextPrice = isCashRow || price.trim() === '' ? null : Number(price);
    if (nextPrice !== (transaction.price ?? null)) body.price = nextPrice;

    if (amount.trim() !== '' && Number(amount) !== transaction.amount)
      body.amount = Number(amount);

    // Compared as calendar days, not instants: the stored value carries a time
    // the input never showed, so an instant comparison would call every save a
    // date change and re-stamp the row at midday.
    if (date && date !== toDateInput(transaction.date))
      body.date = new Date(`${date}T12:00:00Z`).toISOString();

    const nextDesc = orNull(description);
    if (nextDesc !== (transaction.description ?? null)) body.description = nextDesc;

    const nextRef = orNull(reference);
    if (nextRef !== (transaction.reference ?? null)) body.reference = nextRef;

    return body;
  }, [
    transaction,
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
   * quantity x price against the amount that settled. Only a prompt: fees and
   * taxes make a legitimate gap, so this never blocks the save.
   */
  const impliedMismatch = useMemo(() => {
    if (isCashRow) return null;
    const q = Number(quantity);
    const p = Number(price);
    const a = Number(amount);
    if (!q || !p || !a) return null;
    const implied = q * p;
    // A tenth of a percent absorbs rounding; anything wider is worth a look.
    if (Math.abs(implied - a) <= Math.abs(a) * 0.001) return null;
    return implied;
  }, [isCashRow, quantity, price, amount]);

  const submit = async () => {
    if (!transaction) return;

    const e: Record<string, string> = {};
    const value = Number(amount);

    if (!amount.trim()) e.amount = 'Amount is required';
    else if (!Number.isFinite(value)) e.amount = 'Amount must be a number';
    if (!date) e.date = 'Date is required';
    else if (new Date(`${date}T12:00:00Z`).getTime() > Date.now())
      // Mirrors the backend's IsNotFutureDate. A forward-dated row is excluded
      // from every performance window while still showing in holdings.
      e.date = 'Date cannot be in the future';
    if (!isCashRow && !ticker.trim()) e.ticker = 'Instrument is required';
    if (quantity.trim() && !Number.isFinite(Number(quantity)))
      e.quantity = 'Quantity must be a number';
    if (price.trim() && !Number.isFinite(Number(price)))
      e.price = 'Price must be a number';

    setErrors(e);
    if (Object.keys(e).length > 0) return;

    if (changedCount === 0) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      const updated = await transactionsApi.update(transaction.id, patch);
      onSaved(updated);
      toast({
        tone: 'success',
        title: 'Transaction updated',
        description: affectsReturn
          ? `${client?.name ?? 'The client'}'s return is recalculated on the next read.`
          : undefined,
      });
      onClose();
    } catch (err) {
      const { message, fields } = parseApiError(err);
      setErrors(fields);
      toast({ tone: 'error', title: 'Could not update transaction', description: message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={!!transaction}
      onClose={() => !saving && onClose()}
      title="Edit Transaction"
      description="Correct a ledger entry. The client it belongs to cannot be changed here."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={changedCount === 0}>
            {changedCount === 0
              ? 'No changes'
              : `Save ${changedCount} change${changedCount === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      {transaction && (
        <div className="space-y-5">
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

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {/*
              Read-only rather than absent: the operator must be able to see
              WHICH book they are correcting before they change a figure in it.
            */}
            <Input
              label="Client"
              value={client?.name ?? 'Unknown client'}
              readOnly
              disabled
              helper="Move an entry between clients by deleting and re-recording it"
            />

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
              <>
                <Input
                  label="Instrument"
                  required
                  placeholder="ICICIBANK.NS"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  error={errors.ticker}
                />

                <Input
                  label="Quantity"
                  type="number"
                  min="0"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  error={errors.quantity}
                />

                <Input
                  label="Price"
                  type="number"
                  min="0"
                  step="any"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  error={errors.price}
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
              helper={isCashRow ? 'Cash moved' : 'Net of brokerage and taxes'}
            />

            <Input
              label="Date"
              required
              type="date"
              max={new Date().toISOString().slice(0, 10)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              error={errors.date}
            />
          </div>

          {impliedMismatch !== null && (
            <p className="text-[13px] leading-relaxed text-ink-secondary">
              Quantity x price is{' '}
              <span className="font-medium text-ink">
                {formatCurrency(impliedMismatch, currency)}
              </span>
              , against an amount of{' '}
              <span className="font-medium text-ink">
                {formatCurrency(Number(amount), currency)}
              </span>
              . That gap is expected if it includes brokerage and taxes — the amount is
              saved exactly as typed.
            </p>
          )}

          <Textarea
            label="Notes"
            placeholder="Corrected from the contract note…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            error={errors.description}
            rows={2}
          />

          <Input
            label="Reference"
            placeholder="Contract note number"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            error={errors.reference}
          />
        </div>
      )}
    </Modal>
  );
}
