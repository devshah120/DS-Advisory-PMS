'use client';

import { useEffect, useState } from 'react';
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
  Lock,
  Users,
} from 'lucide-react';
import { CreateClientInput, parseApiError } from '@/lib/clients.api';
import { familiesApi } from '@/lib/families.api';
import { Family, RiskProfile } from '@/types';
import { useMarket } from '@/components/layout/MarketContext';
import { Card, CardHeader, Input, Select, Textarea, Button, Badge, useToast } from '@/components/ui';

/**
 * Sentinel for the "create a new household" option in the family dropdown.
 *
 * Managers group accounts as they onboard them — the second account of a family
 * is added right after the first — so making them leave the form, create a
 * family elsewhere and come back would be the wrong shape entirely.
 */
const NEW_FAMILY = '__new__';

export interface ClientFormValues {
  name: string;
  broker: string;
  accountNumber: string;
  email: string;
  /** Login password for the client's account. Required on create; blank on edit means "unchanged". */
  password: string;
  benchmark: string;
  riskProfile: RiskProfile;
  feeRatePercent: string;
  inceptionDate: string;
  currency: string;
  /** Manually maintained buying-power balance. Blank means "none entered". */
  cashBalance: string;
  /**
   * The household this mandate belongs to. Empty means standalone; NEW_FAMILY
   * means "create the one named in `newFamilyName`" on submit.
   */
  familyId: string;
  /** Only read when `familyId` is NEW_FAMILY. */
  newFamilyName: string;
  notes: string;
}

export const emptyClientForm: ClientFormValues = {
  name: '',
  broker: '',
  accountNumber: '',
  email: '',
  password: '',
  benchmark: '',
  riskProfile: 'moderate',
  feeRatePercent: '',
  inceptionDate: '',
  currency: 'USD',
  cashBalance: '',
  familyId: '',
  newFamilyName: '',
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
  // Households are per book, so only the selected book's families are offered —
  // the API rejects a cross-book member anyway, and offering one would be a
  // dead end the manager only discovers on submit.
  const { market, meta, ready: marketReady } = useMarket();
  const [form, setForm] = useState<ClientFormValues>(initial);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [families, setFamilies] = useState<Family[]>([]);

  useEffect(() => {
    if (!marketReady) return;
    let mounted = true;
    familiesApi
      .list(market)
      .then((rows) => mounted && setFamilies(rows))
      // A failed load leaves the dropdown with just "None" and "Create new" —
      // the manager can still onboard the client and group it later.
      .catch(() => mounted && setFamilies([]));
    return () => {
      mounted = false;
    };
  }, [market, marketReady]);

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
    // On create the email is required — it's the login account's unique key.
    // On edit it stays optional (unless the client never had a login), but if
    // entered it must still look like an email.
    if (mode === 'create' && form.email.trim() === '')
      e.email = 'Email is required to create the login';
    else if (form.email.trim() !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      e.email = 'Enter a valid email address';
    // Password: required on create; on edit, blank means "leave unchanged", but
    // any value entered must meet the 8-char minimum the API enforces.
    if (mode === 'create' && form.password === '')
      e.password = 'A login password is required';
    else if (form.password !== '' && form.password.length < 8)
      e.password = 'Password must be at least 8 characters';
    if (!form.benchmark.trim()) e.benchmark = 'Benchmark is required';
    if (form.feeRatePercent.trim() === '') e.feeRatePercent = 'Enter the annual fee rate (0 if none)';
    else if (Number(form.feeRatePercent) < 0 || Number(form.feeRatePercent) > 100)
      e.feeRatePercent = 'Fee rate must be between 0 and 100';
    if (!form.inceptionDate) e.inceptionDate = 'Inception date is required';
    // Cash is optional, but if entered it must be a non-negative number.
    if (form.cashBalance.trim() !== '' && (Number.isNaN(Number(form.cashBalance)) || Number(form.cashBalance) < 0))
      e.cashBalance = 'Cash balance must be a number of 0 or more';
    // Choosing "Create new family" without naming it would create a nameless
    // household, so the name becomes required exactly then.
    if (form.familyId === NEW_FAMILY && !form.newFamilyName.trim())
      e.newFamilyName = 'Name the new family';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setErrors({});

    // Resolve "create new" into a real family id first, so the client write
    // carries a valid FK. Done before the client call rather than after, since
    // a client saved without its household would silently lose the grouping the
    // manager just asked for.
    let familyId: string | null = form.familyId === NEW_FAMILY ? null : form.familyId || null;
    if (form.familyId === NEW_FAMILY) {
      try {
        const created = await familiesApi.create({
          name: form.newFamilyName.trim(),
          market,
        });
        familyId = created.id;
        setFamilies((prev) => [...prev, created]);
      } catch (err) {
        const { message, fields } = parseApiError(err);
        setErrors({ ...fields, newFamilyName: fields.name ?? message });
        toast({ tone: 'error', title: 'Could not create the family', description: message });
        setLoading(false);
        return;
      }
    }

    // Send exactly the fields the API accepts — the backend rejects unknown keys.
    const payload: CreateClientInput = {
      // Always sent, including as null, so clearing the field detaches the
      // client from its household rather than leaving the old link in place.
      familyId,
      name: form.name.trim(),
      broker: form.broker.trim(),
      accountNumber: form.accountNumber.trim(),
      benchmark: form.benchmark.trim(),
      // Only send email when entered — the API rejects an empty string.
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      // Send the login password only when set. On edit a blank field is omitted
      // so the existing password is left unchanged.
      ...(form.password ? { password: form.password } : {}),
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
            required={mode === 'create'}
            placeholder="contact@evergreen.com"
            leftIcon={<Mail className="h-4 w-4" />}
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            error={errors.email}
            helper="The client's login email — also used as their contact address"
          />
          <Input
            label="Login Password"
            type="password"
            required={mode === 'create'}
            autoComplete="new-password"
            placeholder={mode === 'edit' ? 'Leave blank to keep current' : 'At least 8 characters'}
            leftIcon={<Lock className="h-4 w-4" />}
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            error={errors.password}
            helper={
              mode === 'edit'
                ? 'Enter a new password to reset the client login, or leave blank'
                : "The client signs in with this password and the email above"
            }
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
          <Select
            label="Family"
            value={form.familyId}
            onChange={(e) => set('familyId', e.target.value)}
            error={errors.familyId}
            helper={`Group accounts that belong to one household. The family appears alongside individual clients on Holdings, showing their combined positions. ${meta.label} book only.`}
          >
            <option value="">None — standalone account</option>
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.memberCount > 0
                  ? ` · ${f.memberCount} account${f.memberCount === 1 ? '' : 's'}`
                  : ''}
              </option>
            ))}
            <option value={NEW_FAMILY}>+ Create a new family…</option>
          </Select>
          {form.familyId === NEW_FAMILY && (
            <Input
              label="New Family Name"
              required
              placeholder="Shah Family"
              leftIcon={<Users className="h-4 w-4" />}
              value={form.newFamilyName}
              onChange={(e) => set('newFamilyName', e.target.value)}
              error={errors.newFamilyName}
              helper={`Created in the ${meta.label} book when you save, with this client as its first member`}
            />
          )}
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
