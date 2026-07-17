'use client';

import { useState } from 'react';
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
import {
  Card,
  CardHeader,
  Input,
  Select,
  Button,
  Badge,
  Tabs,
  useToast,
} from '@/components/ui';

type Section = 'profile' | 'preferences' | 'notifications' | 'security';

export default function SettingsPage() {
  const { toast } = useToast();
  const [section, setSection] = useState<Section>('profile');
  const [saving, setSaving] = useState(false);

  const [profile, setProfile] = useState({
    firstName: 'Dev',
    lastName: 'User',
    email: 'altas@gmail.com',
    organization: 'Atlas Capital',
    role: 'portfolio_manager',
  });

  const [prefs, setPrefs] = useState({
    theme: 'system',
    baseCurrency: 'USD',
    dateFormat: 'MMM D, YYYY',
    numberFormat: 'en-US',
    density: 'comfortable',
  });

  const [notifications, setNotifications] = useState({
    tradeAlerts: true,
    priceTargets: true,
    weeklyDigest: true,
    corporateActions: false,
    productUpdates: false,
  });

  const setP = (k: string, v: string) => setProfile((p) => ({ ...p, [k]: v }));
  const setPref = (k: string, v: string) => setPrefs((p) => ({ ...p, [k]: v }));
  const toggleNotif = (k: keyof typeof notifications) =>
    setNotifications((n) => ({ ...n, [k]: !n[k] }));

  const save = () => {
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      toast({ tone: 'success', title: 'Settings saved' });
    }, 700);
  };

  return (
    <AppShell
      title="Settings"
      subtitle="Manage your profile, preferences, and security"
      actions={
        <Button loading={saving} leftIcon={<Check className="h-4 w-4" />} onClick={save}>
          Save changes
        </Button>
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
          {section === 'profile' && (
            <Card>
              <CardHeader title="Profile" subtitle="Your personal and organization details" />
              <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                <Input
                  label="First Name"
                  leftIcon={<User className="h-4 w-4" />}
                  value={profile.firstName}
                  onChange={(e) => setP('firstName', e.target.value)}
                />
                <Input
                  label="Last Name"
                  leftIcon={<User className="h-4 w-4" />}
                  value={profile.lastName}
                  onChange={(e) => setP('lastName', e.target.value)}
                />
                <Input
                  label="Email"
                  type="email"
                  leftIcon={<Mail className="h-4 w-4" />}
                  value={profile.email}
                  onChange={(e) => setP('email', e.target.value)}
                />
                <Input
                  label="Organization"
                  leftIcon={<Building2 className="h-4 w-4" />}
                  value={profile.organization}
                  onChange={(e) => setP('organization', e.target.value)}
                />
                <Select label="Role" value={profile.role} onChange={(e) => setP('role', e.target.value)}>
                  <option value="admin">Admin</option>
                  <option value="portfolio_manager">Portfolio Manager</option>
                  <option value="research_analyst">Research Analyst</option>
                  <option value="viewer">Viewer</option>
                </Select>
              </div>
            </Card>
          )}

          {section === 'preferences' && (
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

          {section === 'notifications' && (
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
                  <Input label="Current Password" type="password" leftIcon={<KeyRound className="h-4 w-4" />} placeholder="••••••••" />
                  <div className="hidden md:block" />
                  <Input label="New Password" type="password" leftIcon={<KeyRound className="h-4 w-4" />} placeholder="••••••••" />
                  <Input label="Confirm New Password" type="password" leftIcon={<KeyRound className="h-4 w-4" />} placeholder="••••••••" />
                </div>
                <div className="mt-5">
                  <Button
                    variant="outline"
                    leftIcon={<ShieldCheck className="h-4 w-4" />}
                    onClick={() => toast({ tone: 'success', title: 'Password updated' })}
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
        </div>
      </div>
    </AppShell>
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
