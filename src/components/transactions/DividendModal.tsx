'use client';

import { useState } from 'react';
import { transactionsApi } from '@/lib/transactions.api';
import { parseApiError } from '@/lib/clients.api';
import { Client, Transaction } from '@/types';
import { Modal, Input, Select, Textarea, Button, useToast } from '@/components/ui';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Records a dividend received.
 *
 * Unlike cash flows, this applies to EVERY client regardless of accounting
 * method: a dividend is the portfolio earning money, and it raises the return
 * under both methods (as an explicit flow for transactional clients, and through
 * the cash balance for cash-flow ones). So the client list here is not filtered.
 */
export function DividendModal({
  isOpen,
  onClose,
  clients,
  onRecorded,
}: {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  onRecorded: (tx: Transaction) => void;
}) {
  const { toast } = useToast();

  const [clientId, setClientId] = useState('');
  const [ticker, setTicker] = useState('');
  const [amount, setAmount] = useState('');
  const [quantity, setQuantity] = useState('');
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setClientId('');
    setTicker('');
    setAmount('');
    setQuantity('');
    setDate(today());
    setDescription('');
    setErrors({});
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    const value = Number(amount);

    if (!clientId) e.clientId = 'Select a client';
    if (!ticker.trim()) e.ticker = 'Ticker is required';
    if (!amount.trim()) e.amount = 'Amount is required';
    else if (!Number.isFinite(value) || value <= 0)
      e.amount = 'Amount must be greater than zero';
    if (!date) e.date = 'Payment date is required';

    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    try {
      const tx = await transactionsApi.createDividend({
        clientId,
        ticker: ticker.trim().toUpperCase(),
        amount: value,
        ...(quantity.trim() ? { quantity: Number(quantity) } : {}),
        // Midday UTC — a bare date parses as midnight UTC, which is the previous
        // day west of Greenwich, and XIRR is sensitive to the date.
        date: new Date(`${date}T12:00:00Z`).toISOString(),
        ...(description.trim() ? { description: description.trim() } : {}),
      });

      onRecorded(tx);
      toast({
        tone: 'success',
        title: 'Dividend recorded',
        description: 'This increases the client’s return on the next calculation.',
      });
      close();
    } catch (err) {
      const { message, fields } = parseApiError(err);
      setErrors(fields);
      toast({ tone: 'error', title: 'Could not record dividend', description: message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Record Dividend"
      description="Cash received on a holding. This raises the client’s return."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Record
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Select
            label="Client"
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
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
            label="Ticker"
            required
            placeholder="AAPL"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            error={errors.ticker}
            helper="The holding that paid"
          />

          <Input
            label="Amount Received"
            required
            type="number"
            min="0"
            step="0.01"
            placeholder="500.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={errors.amount}
            helper="Total cash, not per share"
          />

          <Input
            label="Payment Date"
            required
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            error={errors.date}
          />

          <Input
            label="Shares Held"
            type="number"
            min="0"
            step="any"
            placeholder="100"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            error={errors.quantity}
            helper="Optional — recorded for audit"
          />
        </div>

        <Textarea
          label="Notes"
          placeholder="Q2 declared dividend…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={errors.description}
          rows={3}
        />
      </div>
    </Modal>
  );
}
