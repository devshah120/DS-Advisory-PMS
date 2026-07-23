'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Equal, Wallet } from 'lucide-react';
import { clientsApi, parseApiError } from '@/lib/clients.api';
import { formatCurrency, cn } from '@/lib/utils';
import { Client } from '@/types';
import { Modal, Input, Select, Button, useToast } from '@/components/ui';

/**
 * Sets a client's deployable cash — the uninvested buying-power balance the
 * manager maintains for them (`Client.cashBalance`).
 *
 * This is NOT a return-affecting transaction. The cash-flow accounting method
 * has been retired: every client's XIRR is transactional and idle cash is
 * excluded from it. Cash is tracked purely so the manager can see what is
 * available to deploy (Holdings / Clients / Dashboard all read this figure).
 *
 * Three modes, all writing the same `cashBalance` field:
 *   Set      — replace the balance with an exact figure (the common case).
 *   Deposit  — add to the current balance (cash came in).
 *   Withdraw — subtract from it (cash was pulled out or deployed elsewhere).
 *
 * Deposit/Withdraw are conveniences layered over Set: they compute the new
 * absolute balance on the client and still persist a single `cashBalance`
 * value, so there is never a separate ledger to reconcile.
 */
type Mode = 'set' | 'deposit' | 'withdraw';

export function CashFlowModal({
  isOpen,
  onClose,
  clients,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  /** The updated client, so the parent can refresh every cash figure it shows. */
  onSaved: (client: Client) => void;
}) {
  const { toast } = useToast();

  const [clientId, setClientId] = useState('');
  const [mode, setMode] = useState<Mode>('set');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const selected = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId]
  );
  const currentCash = selected?.cashBalance ?? 0;

  // Pre-fill the Set field with the current balance when a client is picked, so
  // the common "adjust the existing figure" edit starts from the real number
  // rather than a blank the manager might read as "current cash is zero".
  useEffect(() => {
    if (mode === 'set') setAmount(selected ? String(currentCash) : '');
    else setAmount('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, mode]);

  const reset = () => {
    setClientId('');
    setMode('set');
    setAmount('');
    setErrors({});
  };

  const close = () => {
    reset();
    onClose();
  };

  /** The absolute balance this submission will persist, or null if invalid. */
  const nextBalance = (): number | null => {
    const value = Number(amount);
    if (!Number.isFinite(value)) return null;
    if (mode === 'set') return value;
    if (mode === 'deposit') return currentCash + value;
    return currentCash - value; // withdraw
  };

  const submit = async () => {
    const e: Record<string, string> = {};
    const value = Number(amount);

    if (!clientId) e.clientId = 'Select a client';
    if (!amount.trim()) e.amount = 'Amount is required';
    else if (!Number.isFinite(value) || value < 0)
      e.amount = 'Amount must be 0 or more';

    const next = nextBalance();
    if (next !== null && next < 0) {
      // A withdrawal can't take a client below zero cash — that would be spending
      // money they don't have on hand.
      e.amount = `That leaves a negative balance (${formatCurrency(next)}). The client only holds ${formatCurrency(currentCash)}.`;
    }

    setErrors(e);
    if (Object.keys(e).length > 0 || next === null) return;

    setSaving(true);
    try {
      const updated = await clientsApi.update(clientId, { cashBalance: next });
      onSaved(updated);
      toast({
        tone: 'success',
        title: 'Cash balance updated',
        description: `${updated.name} now holds ${formatCurrency(next)} in deployable cash.`,
      });
      close();
    } catch (err) {
      const { message, fields } = parseApiError(err);
      setErrors(fields);
      toast({ tone: 'error', title: 'Could not update cash balance', description: message });
    } finally {
      setSaving(false);
    }
  };

  const preview = nextBalance();

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Set Deployable Cash"
      description="The uninvested cash you're holding for a client, available to deploy. Tracked for allocation — it doesn't affect the transactional XIRR."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={clients.length === 0}>
            Save cash balance
          </Button>
        </>
      }
    >
      {clients.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-ink-secondary">
          You have no clients yet. Add a client first, then set their deployable cash here.
        </p>
      ) : (
        <div className="space-y-5">
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

          {selected && (
            <div className="rounded-[12px] border border-border bg-surface-2 px-4 py-3">
              <p className="text-xs text-ink-secondary">Current deployable cash</p>
              <p className="value-display text-lg font-semibold text-ink">
                {formatCurrency(currentCash)}
              </p>
            </div>
          )}

          {/* How to change the balance — set an exact figure, or nudge it up/down. */}
          <div>
            <label className="mb-2 block text-[13px] font-medium text-ink">How</label>
            <div className="grid grid-cols-3 gap-3">
              <ModeButton
                active={mode === 'set'}
                onClick={() => setMode('set')}
                icon={<Equal className="h-4 w-4" />}
                label="Set to"
                hint="Exact balance"
                tone="brand"
              />
              <ModeButton
                active={mode === 'deposit'}
                onClick={() => setMode('deposit')}
                icon={<ArrowDownLeft className="h-4 w-4" />}
                label="Deposit"
                hint="Add cash"
                tone="success"
              />
              <ModeButton
                active={mode === 'withdraw'}
                onClick={() => setMode('withdraw')}
                icon={<ArrowUpRight className="h-4 w-4" />}
                label="Withdraw"
                hint="Remove cash"
                tone="warning"
              />
            </div>
          </div>

          <Input
            label={mode === 'set' ? 'New cash balance' : mode === 'deposit' ? 'Amount to add' : 'Amount to remove'}
            required
            type="number"
            min="0"
            step="0.01"
            placeholder="20000.00"
            leftIcon={<Wallet className="h-4 w-4" />}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={errors.amount}
            helper={
              mode === 'set'
                ? 'The total cash on hand for this client after saving'
                : 'Always positive — the mode above sets the direction'
            }
          />

          {/* Show the resulting balance for deposit/withdraw so the manager sees
              exactly what will be saved before committing. */}
          {selected && mode !== 'set' && amount.trim() !== '' && preview !== null && preview >= 0 && (
            <div className="flex items-center justify-between rounded-[12px] border border-border bg-surface-2 px-4 py-3">
              <span className="text-[13px] text-ink-secondary">New balance after saving</span>
              <span className="value-display text-base font-semibold text-ink">
                {formatCurrency(preview)}
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function ModeButton({
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
  tone: 'brand' | 'success' | 'warning';
}) {
  const activeRing =
    tone === 'success'
      ? 'border-success bg-success/[0.06] ring-1 ring-success'
      : tone === 'warning'
        ? 'border-warning bg-warning/[0.06] ring-1 ring-warning'
        : 'border-brand bg-brand/[0.06] ring-1 ring-brand';
  const activeIcon =
    tone === 'success' ? 'bg-success text-white' : tone === 'warning' ? 'bg-warning text-white' : 'bg-brand text-white';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2.5 rounded-[12px] border p-3 text-left transition-all',
        active ? activeRing : 'border-border bg-white hover:border-ink-tertiary hover:bg-surface-2'
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]',
          active ? activeIcon : 'bg-surface-3 text-ink-secondary'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-ink">{label}</span>
        <span className="block text-2xs text-ink-tertiary">{hint}</span>
      </span>
    </button>
  );
}
