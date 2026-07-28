'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  User,
  Mail,
  Building2,
  ShieldCheck,
  Check,
  KeyRound,
  Monitor,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import AppShell from '@/components/layout/AppShell';
import { parseApiError } from '@/lib/clients.api';
import {
  usersApi,
  type UserNotifications,
  type UserPreferences,
  type UserProfile,
} from '@/lib/users.api';
import type { UserRole } from '@/types';
import {
  Card,
  CardHeader,
  Input,
  Select,
  Button,
  Badge,
  Tabs,
  Skeleton,
  useToast,
} from '@/components/ui';

type Section = 'profile' | 'preferences' | 'notifications' | 'security';

interface ProfileForm {
  firstName: string;
  lastName: string;
  email: string;
  organization: string;
  role: UserRole;
}

const EMPTY_PROFILE: ProfileForm = {
  firstName: '',
  lastName: '',
  email: '',
  organization: '',
  role: 'portfolio_manager',
};

const toForm = (p: UserProfile): ProfileForm => ({
  firstName: p.firstName,
  lastName: p.lastName,
  email: p.email,
  // The API stores "not set" as null; the input needs a string.
  organization: p.organization ?? '',
  role: p.role,
});

export default function SettingsPage() {
  const { toast } = useToast();
  const [section, setSection] = useState<Section>('profile');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState<ProfileForm>(EMPTY_PROFILE);
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [notifications, setNotifications] = useState<UserNotifications | null>(null);

  // Server state for the visible tab, so "Save changes" can send only what the
  // user actually changed and stay disabled while the form is untouched.
  const [savedProfile, setSavedProfile] = useState<ProfileForm>(EMPTY_PROFILE);
  const [savedPrefs, setSavedPrefs] = useState<UserPreferences | null>(null);
  const [savedNotifications, setSavedNotifications] =
    useState<UserNotifications | null>(null);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Password form — deliberately separate from the tab-level save: it has its
  // own button, its own validation, and is never part of a bulk patch.
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwErrors, setPwErrors] = useState<Record<string, string>>({});
  const [pwSaving, setPwSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [p, pr, n] = await Promise.all([
        usersApi.getProfile(),
        usersApi.getPreferences(),
        usersApi.getNotifications(),
      ]);
      const form = toForm(p);
      setProfile(form);
      setSavedProfile(form);
      setPrefs(pr);
      setSavedPrefs(pr);
      setNotifications(n);
      setSavedNotifications(n);
    } catch (err) {
      setLoadError(parseApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setP = (k: keyof ProfileForm, v: string) => {
    setProfile((p) => ({ ...p, [k]: v }));
    // Clear the inline error as soon as the user edits that field.
    setFieldErrors((e) => (e[k] ? { ...e, [k]: '' } : e));
  };
  const setPref = (k: keyof UserPreferences, v: string) =>
    setPrefs((p) => (p ? { ...p, [k]: v } : p));
  const toggleNotif = (k: keyof UserNotifications) =>
    setNotifications((n) => (n ? { ...n, [k]: !n[k] } : n));

  /** Only the keys that differ from what the server last returned. */
  function diff<T extends object>(next: T, saved: T | null): Partial<T> {
    if (!saved) return {};
    const out: Partial<T> = {};
    for (const key of Object.keys(next) as (keyof T)[]) {
      if (next[key] !== saved[key]) out[key] = next[key];
    }
    return out;
  }

  const profileChanges = diff(profile, savedProfile);
  const prefChanges = prefs ? diff(prefs, savedPrefs) : {};
  const notifChanges = notifications ? diff(notifications, savedNotifications) : {};

  const dirty =
    section === 'profile'
      ? Object.keys(profileChanges).length > 0
      : section === 'preferences'
        ? Object.keys(prefChanges).length > 0
        : section === 'notifications'
          ? Object.keys(notifChanges).length > 0
          : false;

  /** Mirrors the DTO rules so obvious mistakes never make a round trip. */
  const validateProfile = () => {
    const errs: Record<string, string> = {};
    if (!profile.firstName.trim()) errs.firstName = 'First name is required';
    if (!profile.lastName.trim()) errs.lastName = 'Last name is required';
    if (!profile.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim()))
      errs.email = 'Enter a valid email address';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const save = async () => {
    if (!dirty || saving) return;

    setSaving(true);
    try {
      if (section === 'profile') {
        if (!validateProfile()) {
          setSaving(false);
          return;
        }
        const updated = await usersApi.updateProfile(profileChanges);
        const form = toForm(updated);
        setProfile(form);
        setSavedProfile(form);
      } else if (section === 'preferences') {
        const updated = await usersApi.updatePreferences(prefChanges);
        setPrefs(updated);
        setSavedPrefs(updated);
      } else if (section === 'notifications') {
        const updated = await usersApi.updateNotifications(notifChanges);
        setNotifications(updated);
        setSavedNotifications(updated);
      }
      toast({ tone: 'success', title: 'Settings saved' });
    } catch (err) {
      const { message, fields } = parseApiError(err);
      setFieldErrors(fields);
      toast({ tone: 'error', title: message });
    } finally {
      setSaving(false);
    }
  };

  const changePassword = async () => {
    const errs: Record<string, string> = {};
    if (!pw.current) errs.current = 'Enter your current password';
    if (!pw.next) errs.next = 'Enter a new password';
    else if (pw.next.length < 8) errs.next = 'Password must be at least 8 characters';
    if (pw.next !== pw.confirm) errs.confirm = 'Passwords do not match';
    setPwErrors(errs);
    if (Object.keys(errs).length) return;

    setPwSaving(true);
    try {
      await usersApi.changePassword({
        currentPassword: pw.current,
        newPassword: pw.next,
      });
      setPw({ current: '', next: '', confirm: '' });
      toast({ tone: 'success', title: 'Password updated' });
    } catch (err) {
      const { message } = parseApiError(err);
      // The only field the server can contradict us on is the current password.
      setPwErrors({ current: message });
      toast({ tone: 'error', title: message });
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <AppShell
      title="Settings"
      subtitle="Manage your profile, preferences, and security"
      actions={
        section === 'security' ? undefined : (
          <Button
            loading={saving}
            disabled={loading || !dirty}
            leftIcon={<Check className="h-4 w-4" />}
            onClick={save}
          >
            Save changes
          </Button>
        )
      }
    >
      <div className="space-y-6">
        <Tabs
          tabs={[
            { value: 'profile', label: 'Profile' },
            { value: 'preferences', label: 'Preferences' },
            { value: 'notifications', label: 'Notifications' },
            { value: 'security', label: 'Security' },
          ]}
          value={section}
          onChange={(v) => setSection(v as Section)}
        />

        <div className="mx-auto max-w-3xl space-y-6">
          {loadError && (
            <Card>
              <div className="flex flex-col items-start gap-3 py-2">
                <div>
                  <p className="text-[14px] font-medium text-ink">
                    Couldn&apos;t load your settings
                  </p>
                  <p className="mt-0.5 text-[13px] text-ink-secondary">{loadError}</p>
                </div>
                <Button variant="outline" size="sm" onClick={load}>
                  Try again
                </Button>
              </div>
            </Card>
          )}

          {loading && !loadError && <SettingsSkeleton />}

          {!loading && !loadError && (
            <>
              {section === 'profile' && (
                <Card>
                  <CardHeader title="Profile" subtitle="Your personal and organization details" />
                  <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                    <Input
                      label="First Name"
                      leftIcon={<User className="h-4 w-4" />}
                      value={profile.firstName}
                      error={fieldErrors.firstName || undefined}
                      onChange={(e) => setP('firstName', e.target.value)}
                    />
                    <Input
                      label="Last Name"
                      leftIcon={<User className="h-4 w-4" />}
                      value={profile.lastName}
                      error={fieldErrors.lastName || undefined}
                      onChange={(e) => setP('lastName', e.target.value)}
                    />
                    <Input
                      label="Email"
                      type="email"
                      leftIcon={<Mail className="h-4 w-4" />}
                      value={profile.email}
                      error={fieldErrors.email || undefined}
                      onChange={(e) => setP('email', e.target.value)}
                    />
                    <Input
                      label="Organization"
                      leftIcon={<Building2 className="h-4 w-4" />}
                      value={profile.organization}
                      error={fieldErrors.organization || undefined}
                      onChange={(e) => setP('organization', e.target.value)}
                    />
                    <Select
                      label="Role"
                      value={profile.role}
                      error={fieldErrors.role || undefined}
                      onChange={(e) => setP('role', e.target.value)}
                    >
                      <option value="admin">Admin</option>
                      <option value="portfolio_manager">Portfolio Manager</option>
                      <option value="research_analyst">Research Analyst</option>
                      <option value="viewer">Viewer</option>
                    </Select>
                  </div>
                </Card>
              )}

              {section === 'preferences' && prefs && (
                <Card>
                  <CardHeader
                    title="Preferences"
                    subtitle="Appearance, currency, and formatting"
                  />
                  <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                    <Select label="Theme" value={prefs.theme} onChange={(e) => setPref('theme', e.target.value)}>
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </Select>
                    <Select
                      label="Base Currency"
                      value={prefs.baseCurrency}
                      onChange={(e) => setPref('baseCurrency', e.target.value)}
                    >
                      <option value="USD">USD — US Dollar</option>
                      <option value="EUR">EUR — Euro</option>
                      <option value="GBP">GBP — British Pound</option>
                      <option value="INR">INR — Indian Rupee</option>
                    </Select>
                    <Select
                      label="Date Format"
                      value={prefs.dateFormat}
                      onChange={(e) => setPref('dateFormat', e.target.value)}
                    >
                      <option value="MMM D, YYYY">Jun 1, 2026</option>
                      <option value="DD/MM/YYYY">01/06/2026</option>
                      <option value="MM/DD/YYYY">06/01/2026</option>
                      <option value="YYYY-MM-DD">2026-06-01</option>
                    </Select>
                    <Select
                      label="Number Format"
                      value={prefs.numberFormat}
                      onChange={(e) => setPref('numberFormat', e.target.value)}
                    >
                      <option value="en-US">1,234,567.89</option>
                      <option value="de-DE">1.234.567,89</option>
                      <option value="en-IN">12,34,567.89</option>
                    </Select>
                    <Select
                      label="Table Density"
                      value={prefs.density}
                      onChange={(e) => setPref('density', e.target.value)}
                    >
                      <option value="comfortable">Comfortable</option>
                      <option value="compact">Compact</option>
                    </Select>
                  </div>
                </Card>
              )}

              {section === 'notifications' && notifications && (
                <Card>
                  <CardHeader title="Notifications" subtitle="Choose what we email you about" />
                  <div className="mt-4 divide-y divide-border">
                    <ToggleRow
                      label="Trade alerts"
                      description="Confirmations when orders execute across accounts."
                      checked={notifications.tradeAlerts}
                      onChange={() => toggleNotif('tradeAlerts')}
                    />
                    <ToggleRow
                      label="Price targets"
                      description="Notify when a watchlist idea hits its target price."
                      checked={notifications.priceTargets}
                      onChange={() => toggleNotif('priceTargets')}
                    />
                    <ToggleRow
                      label="Weekly digest"
                      description="A Monday summary of performance and activity."
                      checked={notifications.weeklyDigest}
                      onChange={() => toggleNotif('weeklyDigest')}
                    />
                    <ToggleRow
                      label="Corporate actions"
                      description="Upcoming dividends, earnings, splits, and AGMs."
                      checked={notifications.corporateActions}
                      onChange={() => toggleNotif('corporateActions')}
                    />
                    <ToggleRow
                      label="Product updates"
                      description="Occasional news about new DS Advisory features."
                      checked={notifications.productUpdates}
                      onChange={() => toggleNotif('productUpdates')}
                    />
                  </div>
                </Card>
              )}

              {section === 'security' && (
                <div className="space-y-6">
                  <Card>
                    <CardHeader title="Password" subtitle="Update your account password" />
                    <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                      <Input
                        label="Current Password"
                        type="password"
                        autoComplete="current-password"
                        leftIcon={<KeyRound className="h-4 w-4" />}
                        placeholder="••••••••"
                        value={pw.current}
                        error={pwErrors.current || undefined}
                        onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))}
                      />
                      <div className="hidden md:block" />
                      <Input
                        label="New Password"
                        type="password"
                        autoComplete="new-password"
                        leftIcon={<KeyRound className="h-4 w-4" />}
                        placeholder="••••••••"
                        value={pw.next}
                        error={pwErrors.next || undefined}
                        onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
                      />
                      <Input
                        label="Confirm New Password"
                        type="password"
                        autoComplete="new-password"
                        leftIcon={<KeyRound className="h-4 w-4" />}
                        placeholder="••••••••"
                        value={pw.confirm}
                        error={pwErrors.confirm || undefined}
                        onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
                      />
                    </div>
                    <div className="mt-5">
                      <Button
                        variant="outline"
                        loading={pwSaving}
                        leftIcon={<ShieldCheck className="h-4 w-4" />}
                        onClick={changePassword}
                      >
                        Update password
                      </Button>
                    </div>
                  </Card>

                  <Card>
                    <CardHeader
                      title="Two-Factor Authentication"
                      subtitle="Add an extra layer of security to your account"
                      action={<Badge tone="warning" dot>Disabled</Badge>}
                    />
                    <div className="mt-4">
                      <Button
                        variant="outline"
                        leftIcon={<ShieldCheck className="h-4 w-4" />}
                        onClick={() => toast({ tone: 'info', title: '2FA setup coming soon' })}
                      >
                        Enable 2FA
                      </Button>
                    </div>
                  </Card>

                  <Card>
                    <CardHeader title="Active Sessions" subtitle="Devices currently signed in" />
                    <div className="mt-4 space-y-1">
                      <SessionRow device="Chrome · Windows" location="This device" current />
                      <SessionRow device="Safari · iPhone" location="Mumbai, IN · 2 days ago" />
                    </div>
                  </Card>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function SettingsSkeleton() {
  return (
    <Card>
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <p className="text-[14px] font-medium text-ink">{label}</p>
        <p className="text-[13px] text-ink-secondary">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={cn(
          'relative inline-flex h-[24px] w-[44px] shrink-0 cursor-pointer items-center rounded-full p-[2px] transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2',
          checked ? 'bg-brand' : 'bg-[#d4d8df]'
        )}
      >
        <span
          className={cn(
            'inline-block h-[20px] w-[20px] rounded-full bg-white shadow-sm ring-1 ring-black/5 transition-transform duration-200',
            checked ? 'translate-x-[20px]' : 'translate-x-0'
          )}
        />
      </button>
    </div>
  );
}

function SessionRow({
  device,
  location,
  current,
}: {
  device: string;
  location: string;
  current?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[10px] px-2.5 py-2.5 transition-colors hover:bg-surface-2">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-surface-3 text-ink-secondary">
          <Monitor className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[13px] font-semibold text-ink">{device}</p>
          <p className="text-xs text-ink-tertiary">{location}</p>
        </div>
      </div>
      {current ? (
        <Badge tone="success" dot>
          Active now
        </Badge>
      ) : (
        <Button variant="ghost" size="sm">
          Revoke
        </Button>
      )}
    </div>
  );
}
