'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, KeyRound, Save, CalendarPlus, CreditCard } from 'lucide-react';
import { subscriptionApi } from '@/lib/subscription.api';
import { usersApi } from '@/lib/users.api';
import { parseApiError } from '@/lib/clients.api';
import { isSuperAdmin } from '@/types';
import {
  STATUS_LABELS,
  type AppSettings,
  type Subscriber,
  type SubscriptionStatus,
  type UpdateSettingsInput,
} from '@/types/subscription';
import { formatDate } from '@/lib/utils';
import { usePageHeading } from '@/components/layout/PageHeaderContext';
import {
  Card,
  CardHeader,
  Badge,
  Button,
  Input,
  Select,
  Modal,
  EmptyState,
  Skeleton,
  Tabs,
  useToast,
} from '@/components/ui';

const statusTone: Record<
  SubscriptionStatus,
  'brand' | 'info' | 'neutral' | 'success' | 'warning' | 'danger'
> = {
  TRIALING: 'info',
  ACTIVE: 'success',
  EXPIRED: 'danger',
  PAST_DUE: 'warning',
  CANCELLED: 'neutral',
};

/**
 * Money is edited as a STRING, not a number.
 *
 * A `useState<number>` bound to a text input cannot hold the intermediate
 * states real typing produces — an empty field, or "1200." mid-keystroke — and
 * coercing on every change makes the caret jump. The strings are parsed once,
 * on save.
 */
interface PlanForm {
  trialDays: string;
  monthlyAmount: string;
  yearlyAmount: string;
  currency: string;
}

interface KeyForm {
  razorpayKeyId: string;
  /** Blank means "leave the stored secret alone" — see the save handler. */
  razorpayKeySecret: string;
  razorpayMode: 'test' | 'live';
}

export default function SubscriptionPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [tab, setTab] = useState('plan');
  const [loading, setLoading] = useState(true);
  // null = still resolving the caller's role; false = not permitted.
  const [allowed, setAllowed] = useState<boolean | null>(null);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);

  const [plan, setPlan] = useState<PlanForm>({
    trialDays: '',
    monthlyAmount: '',
    yearlyAmount: '',
    currency: 'INR',
  });
  const [keys, setKeys] = useState<KeyForm>({
    razorpayKeyId: '',
    razorpayKeySecret: '',
    razorpayMode: 'test',
  });

  const [savingPlan, setSavingPlan] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [extending, setExtending] = useState<Subscriber | null>(null);
  const [extendDays, setExtendDays] = useState('30');

  /** Pushes a freshly-saved settings row back into both forms. */
  const applySettings = useCallback((s: AppSettings) => {
    setSettings(s);
    setPlan({
      trialDays: String(s.trialDays),
      monthlyAmount: String(s.monthlyAmount),
      yearlyAmount: String(s.yearlyAmount),
      currency: s.currency,
    });
    setKeys({
      razorpayKeyId: s.razorpayKeyId ?? '',
      // Always blank: the API never sends the secret back, and pre-filling a
      // placeholder here would save that placeholder as the real key.
      razorpayKeySecret: '',
      razorpayMode: s.razorpayMode === 'live' ? 'live' : 'test',
    });
  }, []);

  // The sidebar only links this for a Super Admin, but the URL can be typed.
  // Resolving the role first lets us explain rather than show a failed load.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await usersApi.getProfile();
      if (!isSuperAdmin(me.role)) {
        setAllowed(false);
        return;
      }
      setAllowed(true);

      const [s, subs] = await Promise.all([
        subscriptionApi.getSettings(),
        subscriptionApi.listSubscribers(),
      ]);
      applySettings(s);
      setSubscribers(subs);
    } catch (err) {
      toast({ tone: 'error', title: parseApiError(err).message });
      setAllowed(false);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySettings]);

  useEffect(() => {
    load();
  }, [load]);

  const savePlan = async () => {
    const trialDays = Number(plan.trialDays);
    const monthlyAmount = Number(plan.monthlyAmount);
    const yearlyAmount = Number(plan.yearlyAmount);

    const next: Record<string, string> = {};
    if (!Number.isInteger(trialDays) || trialDays < 0)
      next.trialDays = 'Enter a whole number of days';
    if (!Number.isFinite(monthlyAmount) || monthlyAmount < 0)
      next.monthlyAmount = 'Enter a valid amount';
    if (!Number.isFinite(yearlyAmount) || yearlyAmount < 0)
      next.yearlyAmount = 'Enter a valid amount';

    setErrors(next);
    if (Object.keys(next).length) return;

    setSavingPlan(true);
    try {
      const saved = await subscriptionApi.updateSettings({
        trialDays,
        monthlyAmount,
        yearlyAmount,
        currency: plan.currency,
      });
      applySettings(saved);
      toast({ tone: 'success', title: 'Plan saved' });
    } catch (err) {
      const { message, fields } = parseApiError(err);
      if (fields && Object.keys(fields).length) setErrors(fields);
      else toast({ tone: 'error', title: message });
    } finally {
      setSavingPlan(false);
    }
  };

  const saveKeys = async () => {
    setSavingKeys(true);
    try {
      const payload: UpdateSettingsInput = {
        razorpayKeyId: keys.razorpayKeyId.trim(),
        razorpayMode: keys.razorpayMode,
      };
      // Only send the secret when one was actually typed. Sending '' would
      // clear the stored key, which is what the Clear button is for.
      if (keys.razorpayKeySecret.trim()) {
        payload.razorpayKeySecret = keys.razorpayKeySecret.trim();
      }

      const saved = await subscriptionApi.updateSettings(payload);
      applySettings(saved);
      toast({ tone: 'success', title: 'Razorpay keys saved' });
    } catch (err) {
      toast({ tone: 'error', title: parseApiError(err).message });
    } finally {
      setSavingKeys(false);
    }
  };

  const clearSecret = async () => {
    setSavingKeys(true);
    try {
      const saved = await subscriptionApi.updateSettings({ razorpayKeySecret: '' });
      applySettings(saved);
      toast({ tone: 'success', title: 'Stored secret cleared' });
    } catch (err) {
      toast({ tone: 'error', title: parseApiError(err).message });
    } finally {
      setSavingKeys(false);
    }
  };

  const applyExtension = async () => {
    if (!extending) return;
    const days = Number(extendDays);
    if (!Number.isInteger(days) || days <= 0) {
      toast({ tone: 'error', title: 'Enter a whole number of days' });
      return;
    }

    const target = extending;
    setExtending(null);
    try {
      await subscriptionApi.updateSubscriber(target.id, { extendDays: days });
      setSubscribers(await subscriptionApi.listSubscribers());
      toast({ tone: 'success', title: `Extended ${target.name} by ${days} days` });
    } catch (err) {
      toast({ tone: 'error', title: parseApiError(err).message });
    }
  };

  const setStatus = async (sub: Subscriber, status: SubscriptionStatus) => {
    try {
      await subscriptionApi.updateSubscriber(sub.id, { status });
      setSubscribers(await subscriptionApi.listSubscribers());
      toast({ tone: 'success', title: `${sub.name} marked ${STATUS_LABELS[status]}` });
    } catch (err) {
      toast({ tone: 'error', title: parseApiError(err).message });
    }
  };

  usePageHeading({
    title: 'Subscription',
    subtitle: 'Trial length, seat pricing, and payment keys',
  });

  if (loading || allowed === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!allowed) {
    return (
      <Card padding="lg">
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          title="Super Admin access required"
          description="Only a Super Admin can manage subscription settings and payment keys."
          action={
            <Button variant="secondary" onClick={() => router.push('/dashboard')}>
              Back to Dashboard
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs
        tabs={[
          { value: 'plan', label: 'Plan & Pricing' },
          { value: 'keys', label: 'Razorpay Keys' },
          { value: 'seats', label: 'Manager Seats', count: subscribers.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'plan' && (
        <Card padding="none">
          <div className="px-5 py-5">
            <CardHeader
              title="Plan & Pricing"
              subtitle="What a portfolio manager gets free, and what a seat costs after that"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 border-t border-border px-5 py-5 sm:grid-cols-2">
            <Input
              label="Free trial (days)"
              type="number"
              min={0}
              value={plan.trialDays}
              error={errors.trialDays}
              helper="Applied when a manager is created. Changing it does not move an existing manager's deadline."
              onChange={(e) => setPlan({ ...plan, trialDays: e.target.value })}
            />
            <Select
              label="Currency"
              value={plan.currency}
              onChange={(e) => setPlan({ ...plan, currency: e.target.value })}
            >
              <option value="INR">INR — Indian Rupee</option>
              <option value="USD">USD — US Dollar</option>
            </Select>
            <Input
              label="Monthly price"
              type="number"
              min={0}
              step="0.01"
              value={plan.monthlyAmount}
              error={errors.monthlyAmount}
              helper={`Per manager, per month, in ${plan.currency}.`}
              onChange={(e) => setPlan({ ...plan, monthlyAmount: e.target.value })}
            />
            <Input
              label="Yearly price"
              type="number"
              min={0}
              step="0.01"
              value={plan.yearlyAmount}
              error={errors.yearlyAmount}
              helper="Set 0 if you do not offer an annual plan."
              onChange={(e) => setPlan({ ...plan, yearlyAmount: e.target.value })}
            />
          </div>
          <div className="flex items-center justify-between border-t border-border px-5 py-4">
            <p className="text-[12.5px] text-ink-tertiary">
              {settings?.updatedBy
                ? `Last updated by ${settings.updatedBy} · ${formatDate(new Date(settings.updatedAt))}`
                : settings
                  ? `Last updated ${formatDate(new Date(settings.updatedAt))}`
                  : ''}
            </p>
            <Button
              leftIcon={<Save className="h-4 w-4" />}
              loading={savingPlan}
              onClick={savePlan}
            >
              Save plan
            </Button>
          </div>
        </Card>
      )}

      {tab === 'keys' && (
        <Card padding="none">
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5">
            <CardHeader
              title="Razorpay Keys"
              subtitle="Credentials used to charge manager seats"
            />
            <Badge tone={keys.razorpayMode === 'live' ? 'danger' : 'neutral'} dot>
              {keys.razorpayMode === 'live' ? 'Live mode' : 'Test mode'}
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-border px-5 py-5 sm:grid-cols-2">
            <Input
              label="Key ID"
              placeholder="rzp_test_XXXXXXXXXXXX"
              value={keys.razorpayKeyId}
              helper="The publishable half. Safe to expose to the browser."
              onChange={(e) => setKeys({ ...keys, razorpayKeyId: e.target.value })}
            />
            <Select
              label="Mode"
              value={keys.razorpayMode}
              helper="Use test keys until you are ready to take real payments."
              onChange={(e) =>
                setKeys({ ...keys, razorpayMode: e.target.value as 'test' | 'live' })
              }
            >
              <option value="test">Test</option>
              <option value="live">Live</option>
            </Select>

            <div className="sm:col-span-2">
              <Input
                label="Key Secret"
                type="password"
                autoComplete="new-password"
                leftIcon={<KeyRound className="h-4 w-4" />}
                placeholder={
                  settings?.razorpaySecretSet
                    ? `•••••••••••${settings.razorpaySecretLast4 ?? ''} — leave blank to keep`
                    : 'Paste the secret from your Razorpay dashboard'
                }
                value={keys.razorpayKeySecret}
                helper="Stored encrypted. It is never sent back to the browser once saved."
                onChange={(e) => setKeys({ ...keys, razorpayKeySecret: e.target.value })}
              />
              {settings?.razorpaySecretSet && (
                <div className="mt-2 flex items-center gap-3">
                  <Badge tone="success" dot>
                    Secret configured
                  </Badge>
                  <button
                    type="button"
                    onClick={clearSecret}
                    className="text-[12.5px] font-medium text-danger hover:underline"
                  >
                    Clear stored secret
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end border-t border-border px-5 py-4">
            <Button
              leftIcon={<Save className="h-4 w-4" />}
              loading={savingKeys}
              onClick={saveKeys}
            >
              Save keys
            </Button>
          </div>
        </Card>
      )}

      {tab === 'seats' && (
        <Card padding="none">
          <div className="px-5 py-5">
            <CardHeader
              title="Manager Seats"
              subtitle="Every portfolio manager login and where its subscription stands"
            />
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-y border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
                <th className="px-5 py-2.5">Manager</th>
                <th className="px-5 py-2.5">Status</th>
                <th className="px-5 py-2.5 text-right">Days Left</th>
                <th className="px-5 py-2.5">Renews / Expires</th>
                <th className="px-5 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {subscribers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-[13px] text-ink-tertiary">
                    No portfolio managers yet.
                  </td>
                </tr>
              ) : (
                subscribers.map((s) => {
                  const deadline = s.currentPeriodEnd ?? s.trialEndsAt;
                  return (
                    <tr key={s.id} className="transition-colors hover:bg-surface-2">
                      <td className="px-5 py-3">
                        <p className="text-[13px] font-medium text-ink">{s.name}</p>
                        <p className="text-[12.5px] text-ink-tertiary">{s.email}</p>
                      </td>
                      <td className="px-5 py-3">
                        {s.status ? (
                          <Badge tone={statusTone[s.status]} dot>
                            {STATUS_LABELS[s.status]}
                          </Badge>
                        ) : (
                          <span className="text-[13px] text-ink-tertiary">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-[13px] tabular-nums text-ink-secondary">
                        {s.daysRemaining ?? '—'}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-ink-secondary">
                        {deadline ? formatDate(new Date(deadline)) : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            leftIcon={<CalendarPlus className="h-3.5 w-3.5" />}
                            onClick={() => {
                              setExtendDays('30');
                              setExtending(s);
                            }}
                          >
                            Extend
                          </Button>
                          {s.status === 'ACTIVE' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setStatus(s, 'CANCELLED')}
                            >
                              Cancel
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              leftIcon={<CreditCard className="h-3.5 w-3.5" />}
                              onClick={() => setStatus(s, 'ACTIVE')}
                            >
                              Mark paid
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        isOpen={extending !== null}
        onClose={() => setExtending(null)}
        title={extending ? `Extend ${extending.name}` : 'Extend'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setExtending(null)}>
              Cancel
            </Button>
            <Button onClick={applyExtension}>Extend</Button>
          </>
        }
      >
        <Input
          label="Days to add"
          type="number"
          min={1}
          value={extendDays}
          helper="Added to the current deadline, or to today if the seat has already lapsed."
          onChange={(e) => setExtendDays(e.target.value)}
        />
      </Modal>
    </div>
  );
}
