'use client';

import { useState } from 'react';
import {
  Building2,
  User,
  Hash,
  Mail,
  Target,
  Check,
  Wallet,
  Percent,
  CalendarDays,
} from 'lucide-react';
import { CreateClientInput, parseApiError } from '@/lib/clients.api';
import { RiskProfile } from '@/types';
import { Card, CardHeader, Input, Select, Textarea, Button, Badge, useToast } from '@/components/ui';

export interface ClientFormValues {
  name: string;
  broker: string;
  accountNumber: string;
  email: string;
  benchmark: string;
  riskProfile: RiskProfile;
  feeRatePercent: string;
  inceptionDate: string;
  currency: string;
  /** Manually maintained buying-power balance. Blank means "none entered". */
  cashBalance: string;
  notes: string;
}

export const emptyClientForm: ClientFormValues = {
  name: '',
  broker: '',
  accountNumber: '',
  email: '',
  benchmark: '',
  riskProfile: 'moderate',
  feeRatePercent: '',
  inceptionDate: '',
  currency: 'USD',
  cashBalance: '',
  notes: '',
};

export interface ClientFormProps {
  mode: 'create' | 'edit';
  initial: ClientFormValues;
  onSubmit: (payload: CreateClientInput) => Promise<void>;
  onCancel: () => void;
}

export default function ClientForm({
  mode,
  initial,
  onSubmit,
  onCancel,
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
    // Email is optional, but if entered it must look like an email.
    if (form.email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      e.email = 'Enter a valid email address';
    if (!form.benchmark.trim()) e.benchmark = 'Benchmark is required';
    if (form.feeRatePercent.trim() === '') e.feeRatePercent = 'Enter the annual fee rate (0 if none)';
    else if (Number(form.feeRatePercent) < 0 || Number(form.feeRatePercent) > 100)
      e.feeRatePercent = 'Fee rate must be between 0 and 100';
    if (!form.inceptionDate) e.inceptionDate = 'Inception date is required';
    // Cash is optional, but if entered it must be a non-negative number.
    if (form.cashBalance.trim() !== '' && (Number.isNaN(Number(form.cashBalance)) || Number(form.cashBalance) < 0))
      e.cashBalance = 'Cash balance must be a number of 0 or more';
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
      // Only send email when entered — the API rejects an empty string.
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      riskProfile: form.riskProfile,
      // The cash-flow method has been retired — every client is transactional.
      accountingMethod: 'transactional',
      feeRatePercent: Number(form.feeRatePercent),
      inceptionDate: form.inceptionDate,
      currency: form.currency,
      // Only send cash when the manager actually entered a figure, so leaving it
      // blank doesn't overwrite an existing balance with 0.
      ...(form.cashBalance.trim() !== '' ? { cashBalance: Number(form.cashBalance) } : {}),
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
            label="Email"
            type="email"
            placeholder="contact@evergreen.com"
            leftIcon={<Mail className="h-4 w-4" />}
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            error={errors.email}
            helper="Optional contact email for this mandate"
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
          <Input
            label="Cash Balance"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            leftIcon={<Wallet className="h-4 w-4" />}
            value={form.cashBalance}
            onChange={(e) => set('cashBalance', e.target.value)}
            error={errors.cashBalance}
            helper="Uninvested cash you're holding for this client. Counts toward Portfolio Value; excluded from XIRR (idle cash isn't deployed capital)."
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
