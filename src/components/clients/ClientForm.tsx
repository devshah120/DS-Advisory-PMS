'use client';

import { useState } from 'react';
import {
  Building2,
  User,
  Hash,
  Target,
  Check,
  ArrowLeftRight,
  Wallet,
  Percent,
  CalendarDays,
} from 'lucide-react';
import { CreateClientInput, parseApiError } from '@/lib/clients.api';
import { AccountingMethod, RiskProfile } from '@/types';
import { cn } from '@/lib/utils';
import { Card, CardHeader, Input, Select, Textarea, Button, Badge, useToast } from '@/components/ui';

export interface ClientFormValues {
  name: string;
  broker: string;
  accountNumber: string;
  benchmark: string;
  riskProfile: RiskProfile;
  accountingMethod: AccountingMethod | null;
  feeRatePercent: string;
  inceptionDate: string;
  currency: string;
  notes: string;
}

export const emptyClientForm: ClientFormValues = {
  name: '',
  broker: '',
  accountNumber: '',
  benchmark: '',
  riskProfile: 'moderate',
  // Null, not a default. This decides how the client's return is measured for the
  // life of the mandate, and a pre-ticked box is how the wrong one gets chosen.
  accountingMethod: null,
  feeRatePercent: '',
  inceptionDate: '',
  currency: 'USD',
  notes: '',
};

const METHODS: Array<{
  value: AccountingMethod;
  icon: typeof ArrowLeftRight;
  title: string;
  tagline: string;
  detail: string;
}> = [
  {
    value: 'transactional',
    icon: ArrowLeftRight,
    title: 'Transaction based',
    tagline: 'XIRR from trades',
    detail:
      'Every buy counts as money in and every sell as money out. Use this when you see the trades but the client never tells you what they funded. Return is measured on capital deployed into positions.',
  },
  {
    value: 'cash_flow',
    icon: Wallet,
    title: 'Cash flow based',
    tagline: 'XIRR from client funding',
    detail:
      'You record the inflows and outflows the client actually gives you. Trades are internal moves and do not count as flows. Return is measured on the money the client handed over.',
  },
];

export interface ClientFormProps {
  mode: 'create' | 'edit';
  initial: ClientFormValues;
  onSubmit: (payload: CreateClientInput) => Promise<void>;
  onCancel: () => void;
  /** Locks the accounting-method picker: changing it retroactively on a client with
   *  existing history would silently change the meaning of every past transaction. */
  lockAccountingMethod?: boolean;
}

export default function ClientForm({
  mode,
  initial,
  onSubmit,
  onCancel,
  lockAccountingMethod,
}: ClientFormProps) {
  const { toast } = useToast();
  const [form, setForm] = useState<ClientFormValues>(initial);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof ClientFormValues>(k: K, v: ClientFormValues[K]) => {
    setForm((p) => ({ ...p, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: '' }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Client name is required';
    if (!form.broker.trim()) e.broker = 'Broker is required';
    if (!form.accountNumber.trim()) e.accountNumber = 'Account number is required';
    else if (form.accountNumber.trim().length < 4)
      e.accountNumber = 'Account number looks too short';
    if (!form.benchmark.trim()) e.benchmark = 'Benchmark is required';
    if (!form.accountingMethod)
      e.accountingMethod = 'Choose how this client’s return should be calculated';
    if (form.feeRatePercent.trim() === '') e.feeRatePercent = 'Enter the annual fee rate (0 if none)';
    else if (Number(form.feeRatePercent) < 0 || Number(form.feeRatePercent) > 100)
      e.feeRatePercent = 'Fee rate must be between 0 and 100';
    if (!form.inceptionDate) e.inceptionDate = 'Inception date is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setErrors({});

    // Send exactly the fields the API accepts — the backend rejects unknown keys.
    const payload: CreateClientInput = {
      name: form.name.trim(),
      broker: form.broker.trim(),
      accountNumber: form.accountNumber.trim(),
      benchmark: form.benchmark.trim(),
      riskProfile: form.riskProfile,
      accountingMethod: form.accountingMethod!, // validate() guarantees this is set
      feeRatePercent: Number(form.feeRatePercent),
      inceptionDate: form.inceptionDate,
      currency: form.currency,
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    };

    try {
      await onSubmit(payload);
    } catch (err) {
      const { message, fields } = parseApiError(err);
      setErrors(fields);
      toast({
        tone: 'error',
        title: mode === 'create' ? 'Could not create client' : 'Could not update client',
        description: message,
      });
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Card>
        <CardHeader title="Account Details" subtitle="Core information about the mandate" />
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          <Input
            label="Client Name"
            required
            placeholder="Evergreen Capital"
            leftIcon={<Building2 className="h-4 w-4" />}
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            error={errors.name}
          />
          <Input
            label="Broker / Custodian"
            required
            placeholder="Interactive Brokers"
            leftIcon={<User className="h-4 w-4" />}
            value={form.broker}
            onChange={(e) => set('broker', e.target.value)}
            error={errors.broker}
          />
          <Input
            label="Account Number"
            required
            placeholder="U1234567"
            leftIcon={<Hash className="h-4 w-4" />}
            value={form.accountNumber}
            onChange={(e) => set('accountNumber', e.target.value)}
            error={errors.accountNumber}
          />
          <Input
            label="Benchmark"
            required
            placeholder="S&P 500"
            leftIcon={<Target className="h-4 w-4" />}
            value={form.benchmark}
            onChange={(e) => set('benchmark', e.target.value)}
            error={errors.benchmark}
            helper="Index used for performance comparison"
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Return Methodology"
          subtitle={
            lockAccountingMethod
              ? 'How this client’s XIRR is calculated. Locked after onboarding — changing it would silently rewrite the meaning of every past transaction.'
              : 'How this client’s XIRR is calculated. This cannot be guessed — pick the one that matches the records you actually receive.'
          }
        />
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {METHODS.map((m) => {
            const selected = form.accountingMethod === m.value;
            const Icon = m.icon;
            const disabled = !!lockAccountingMethod && !selected;
            return (
              <button
                key={m.value}
                type="button"
                disabled={disabled}
                onClick={() => !lockAccountingMethod && set('accountingMethod', m.value)}
                aria-pressed={selected}
                className={cn(
                  'group relative rounded-[14px] border p-5 text-left transition-all',
                  selected
                    ? 'border-brand bg-brand/[0.04] ring-1 ring-brand'
                    : 'border-border bg-white hover:border-ink-tertiary hover:bg-surface-2',
                  disabled && 'cursor-not-allowed opacity-50 hover:border-border hover:bg-white'
                )}
              >
                {selected && (
                  <span className="absolute right-4 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                )}

                <span
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-[10px] transition-colors',
                    selected ? 'bg-brand text-white' : 'bg-surface-3 text-ink-secondary'
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>

                <p className="mt-3 text-[15px] font-semibold text-ink">{m.title}</p>
                <p className="mt-0.5 text-xs font-medium text-brand">{m.tagline}</p>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">
                  {m.detail}
                </p>
              </button>
            );
          })}
        </div>

        {errors.accountingMethod && (
          <p className="mt-3 text-[13px] font-medium text-danger">
            {errors.accountingMethod}
          </p>
        )}

        {form.accountingMethod === 'cash_flow' && (
          <p className="mt-4 rounded-[10px] bg-surface-2 px-4 py-3 text-[13px] text-ink-secondary">
            You’ll record this client’s inflows and outflows on the{' '}
            <span className="font-semibold text-ink">Cash Flows</span> tab of the
            Transactions page. Until at least one inflow is recorded, their XIRR will
            show as unavailable.
          </p>
        )}
      </Card>

      <Card>
        <CardHeader title="Mandate Profile" subtitle="Risk appetite and reporting currency" />
        <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          <Select
            label="Risk Profile"
            value={form.riskProfile}
            onChange={(e) => set('riskProfile', e.target.value as RiskProfile)}
            error={errors.riskProfile}
          >
            <option value="conservative">Conservative</option>
            <option value="moderate">Moderate</option>
            <option value="aggressive">Aggressive</option>
          </Select>
          <Select
            label="Base Currency"
            value={form.currency}
            onChange={(e) => set('currency', e.target.value)}
            error={errors.currency}
          >
            <option value="USD">USD — US Dollar</option>
            <option value="EUR">EUR — Euro</option>
            <option value="GBP">GBP — British Pound</option>
            <option value="INR">INR — Indian Rupee</option>
          </Select>
          <Input
            label="Annual Fee Rate"
            required
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="2"
            leftIcon={<Percent className="h-4 w-4" />}
            value={form.feeRatePercent}
            onChange={(e) => set('feeRatePercent', e.target.value)}
            error={errors.feeRatePercent}
            helper="Billed quarterly at this rate ÷ 4 of quarter-end portfolio value"
          />
          <Input
            label="Inception Date"
            required
            type="date"
            leftIcon={<CalendarDays className="h-4 w-4" />}
            value={form.inceptionDate}
            onChange={(e) => set('inceptionDate', e.target.value)}
            error={errors.inceptionDate}
            helper="The mandate's actual start date, for prorating the first billing quarter"
          />
        </div>
        <div className="mt-5">
          <Textarea
            label="Notes"
            placeholder="Mandate objectives, restrictions, or relationship context…"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            error={errors.notes}
            rows={4}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-tertiary">Quick tags:</span>
          <Badge tone="brand">Long-term growth</Badge>
          <Badge tone="success">ESG mandate</Badge>
          <Badge tone="neutral">Tax-sensitive</Badge>
        </div>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" loading={loading} leftIcon={<Check className="h-4 w-4" />}>
          {mode === 'create' ? 'Create Client' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );
}
