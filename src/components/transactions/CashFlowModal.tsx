'use client';

import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { transactionsApi } from '@/lib/transactions.api';
import { parseApiError } from '@/lib/clients.api';
import { cn } from '@/lib/utils';
import { Client, Transaction } from '@/types';
import { Modal, Input, Select, Textarea, Button, useToast } from '@/components/ui';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Records an external cash flow for a cash-flow-basis client.
 *
 * The client list is filtered to cash-flow clients only. A transactional client
 * has no use for this form — their XIRR is driven by their trades, and a stray
 * deposit recorded here would simply never be read.
 */
export function CashFlowModal({
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

  const eligible = useMemo(
    () => clients.filter((c) => c.accountingMethod === 'cash_flow'),
    [clients]
  );

  const [clientId, setClientId] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setClientId('');
    setDirection('in');
    setAmount('');
    setDate(today());
    setDescription('');
    setReference('');
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
    if (!amount.trim()) e.amount = 'Amount is required';
    else if (!Number.isFinite(value) || value <= 0)
      e.amount = 'Amount must be greater than zero';
    if (!date) e.date = 'Date is required';

    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setSaving(true);
    try {
      const tx = await transactionsApi.createCashFlow({
        clientId,
        direction,
        amount: value,
        // Midday UTC: a bare "2026-06-25" parses as midnight UTC, which is the
        // previous day in any negative-offset timezone — and a flow that lands one
        // day early silently shifts the XIRR.
        date: new Date(`${date}T12:00:00Z`).toISOString(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });

      onRecorded(tx);
      toast({
        tone: 'success',
        title: direction === 'in' ? 'Inflow recorded' : 'Outflow recorded',
        description: 'The client’s XIRR will use this on the next calculation.',
      });
      close();
    } catch (err) {
      const { message, fields } = parseApiError(err);
      setErrors(fields);
      toast({ tone: 'error', title: 'Could not record cash flow', description: message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Record Cash Flow"
      description="Money the client gave you, or took back out."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={eligible.length === 0}>
            Record
          </Button>
        </>
      }
    >
      {eligible.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          None of your clients are on the cash-flow method. Cash flows are only used to
          compute returns for cash-flow-basis clients — set a client’s methodology to{' '}
          <span className="font-semibold text-ink">Cash flow based</span> to record them here.
        </p>
      ) : (
        <div className="space-y-5">
          {/* Direction — the sign of the flow, chosen explicitly rather than typed. */}
          <div>
            <label className="mb-2 block text-[13px] font-medium text-ink">Direction</label>
            <div className="grid grid-cols-2 gap-3">
              <DirectionButton
                active={direction === 'in'}
                onClick={() => setDirection('in')}
                icon={<ArrowDownLeft className="h-4 w-4" />}
                label="Inflow"
                hint="Client gave money"
                tone="success"
              />
              <DirectionButton
                active={direction === 'out'}
                onClick={() => setDirection('out')}
                icon={<ArrowUpRight className="h-4 w-4" />}
                label="Outflow"
                hint="Client took money out"
                tone="warning"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Select
              label="Client"
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              error={errors.clientId}
            >
              <option value="">Select a client…</option>
              {eligible.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>

            <Input
              label="Amount"
              required
              type="number"
              min="0"
              step="0.01"
              placeholder="50000.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              error={errors.amount}
              helper="Always positive — the direction above sets the sign"
            />

            <Input
              label="Date"
              required
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              error={errors.date}
              helper="The date the money moved — XIRR is sensitive to this"
            />

            <Input
              label="Reference"
              placeholder="Wire ref / cheque no."
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              error={errors.reference}
            />
          </div>

          <Textarea
            label="Description"
            placeholder="Top-up following Q2 review…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            error={errors.description}
            rows={3}
          />
        </div>
      )}
    </Modal>
  );
}

function DirectionButton({
  active,
  onClick,
  icon,
  label,
  hint,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
  tone: 'success' | 'warning';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-3 rounded-[12px] border p-3.5 text-left transition-all',
        active
          ? tone === 'success'
            ? 'border-success bg-success/[0.06] ring-1 ring-success'
            : 'border-warning bg-warning/[0.06] ring-1 ring-warning'
          : 'border-border bg-white hover:border-ink-tertiary hover:bg-surface-2'
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]',
          active
            ? tone === 'success'
              ? 'bg-success text-white'
              : 'bg-warning text-white'
            : 'bg-surface-3 text-ink-secondary'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-ink">{label}</span>
        <span className="block text-xs text-ink-secondary">{hint}</span>
      </span>
    </button>
  );
}
