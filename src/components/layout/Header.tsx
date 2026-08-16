'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Search,
  Bell,
  ChevronDown,
  ChevronRight,
  Plus,
  Check,
  CircleDollarSign,
  TrendingUp,
  CalendarClock,
  UserPlus,
  Settings,
  LogOut,
} from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { clientsApi } from '@/lib/clients.api';
import { type UserProfile } from '@/lib/users.api';
import { useSession } from './SessionContext';
import { cn } from '@/lib/utils';
import { useMarket } from './MarketContext';
import { ALL_MARKETS, MARKET_META } from '@/lib/market-scope';
import type { Client } from '@/types';

interface HeaderProps {
  onOpenCommand: () => void;
  onLogout: () => void;
}

const crumbLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  holdings: 'Holdings & Allocations',
  clients: 'Clients',
  add: 'New',
  symbols: 'Symbols',
  auth: 'Account',
};

/**
 * Avatar initials for the signed-in user — "Dev Shah" becomes "DS".
 *
 * Falls back to the email's first letter for accounts whose names haven't been
 * filled in, and to a neutral dash while the profile is still loading, so the
 * avatar never briefly displays someone else's initials.
 */
function initials(profile: UserProfile | null) {
  if (!profile) return '—';

  const letters = [profile.firstName, profile.lastName]
    .map((part) => part?.trim()?.[0] ?? '')
    .join('');

  return (letters || profile.email?.[0] || '?').toUpperCase();
}

const notifications = [
  { icon: TrendingUp, tone: 'text-success', title: 'NVDA up 4.2% today', time: '12m ago' },
  { icon: CircleDollarSign, tone: 'text-brand', title: 'Dividend credited — $3,200', time: '1h ago' },
  { icon: CalendarClock, tone: 'text-warning', title: 'Quarterly review due Friday', time: '3h ago' },
];

export default function Header({ onOpenCommand, onLogout }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { market, meta, setMarket, ready: marketReady } = useMarket();
  const [clients, setClients] = useState<Client[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  // Shared with the Sidebar via SessionProvider, so the profile is fetched once
  // for the shell rather than once per consumer. A failed load leaves this null
  // and the avatar falls back to a neutral placeholder.
  const { profile } = useSession();

  // Re-fetched whenever the book changes: the client switcher must only offer
  // clients from the selected market, otherwise picking a US client while the
  // India book is showing would put the two selectors in contradiction.
  useEffect(() => {
    if (!marketReady) return;
    let active = true;
    clientsApi
      .list({ limit: 100, market })
      .then((list) => {
        if (!active) return;
        setClients(list);
        // Drop a selection that doesn't exist in the newly-selected book,
        // rather than leaving a stale name in the button.
        setWorkspaceId((current) =>
          current && list.some((c) => c.id === current) ? current : null,
        );
      })
      .catch(() => {
        /* leave the switcher empty if clients can't be loaded */
      });
    return () => {
      active = false;
    };
  }, [market, marketReady]);

  const workspace = clients.find((c) => c.id === workspaceId) ?? null;
  const workspaceName = workspace?.name ?? 'Select client';

  const segments = pathname.split('/').filter(Boolean);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border glass px-6">
      {/* Breadcrumbs */}
      <nav className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <Link href="/dashboard" className="font-medium text-ink-tertiary hover:text-ink">
          Giriraj Global Capital
        </Link>
        {segments.map((seg, i) => {
          const last = i === segments.length - 1;
          return (
            <span key={i} className="flex items-center gap-1.5">
              <ChevronRight className="h-3.5 w-3.5 text-ink-tertiary" />
              <span
                className={cn(
                  'truncate',
                  last ? 'font-semibold text-ink' : 'font-medium text-ink-tertiary'
                )}
              >
                {crumbLabels[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1)}
              </span>
            </span>
          );
        })}
      </nav>

      <div className="flex-1" />

      {/* Global search trigger */}
      <button
        onClick={onOpenCommand}
        className="hidden h-9 items-center gap-2 rounded-[10px] border border-border bg-surface-2 px-3 text-[13px] text-ink-tertiary transition-colors hover:border-border-strong hover:text-ink-secondary md:flex"
      >
        <Search className="h-4 w-4" />
        <span>Search…</span>
        <kbd className="ml-2 rounded-[6px] border border-border bg-white px-1.5 py-0.5 text-2xs font-medium text-ink-tertiary">
          ⌘K
        </kbd>
      </button>

      {/* Country / book selector — scopes every figure in the app to one market. */}
      <Dropdown
        width={220}
        items={ALL_MARKETS.map((code) => {
          const m = MARKET_META[code];
          return {
            label: `${m.flag}  ${m.label}`,
            icon:
              code === market ? (
                <Check className="h-4 w-4 text-brand" />
              ) : (
                <span className="h-4 w-4" />
              ),
            onClick: () => setMarket(code),
          };
        })}
        trigger={
          <button
            className="flex h-9 items-center gap-2 rounded-[10px] border border-border bg-white px-3 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2"
            title={`Showing the ${meta.label} book (${meta.currency})`}
          >
            <span className="text-[15px] leading-none">{meta.flag}</span>
            <span className="hidden sm:inline">{meta.shortLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 text-ink-tertiary" />
          </button>
        }
      />

      {/* Workspace selector */}
      <Dropdown
        width={240}
        items={clients.map((c) => ({
          label: c.name,
          icon: c.id === workspaceId ? <Check className="h-4 w-4 text-brand" /> : <span className="h-4 w-4" />,
          onClick: () => setWorkspaceId(c.id),
        }))}
        trigger={
          <button
            className={cn(
              'hidden h-9 items-center gap-2 rounded-[10px] border border-border bg-white px-3 text-[13px] font-medium transition-colors hover:bg-surface-2 lg:flex',
              // Muted until a client is chosen, so the prompt reads as a
              // placeholder rather than as a selected value.
              workspace ? 'text-ink' : 'text-ink-secondary'
            )}
          >
            {workspace && (
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-brand to-brand-active text-2xs font-bold text-white">
                {workspace.name.charAt(0)}
              </span>
            )}
            <span className="max-w-[140px] truncate">{workspaceName}</span>
            <ChevronDown className="h-3.5 w-3.5 text-ink-tertiary" />
          </button>
        }
      />

      {/* Quick action */}
      <Dropdown
        width={210}
        items={[
          { label: 'Add Client', icon: <UserPlus className="h-4 w-4" />, onClick: () => router.push('/clients/add') },
          { label: 'Add Symbol', icon: <Plus className="h-4 w-4" />, onClick: () => router.push('/symbols/add') },
        ]}
        trigger={
          <button className="flex h-9 items-center gap-1.5 rounded-[10px] bg-brand px-3 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-brand-hover">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New</span>
          </button>
        }
      />

      {/* Notifications */}
      <div className="relative">
        <button
          onClick={() => setNotifOpen((v) => !v)}
          className="relative flex h-9 w-9 items-center justify-center rounded-[10px] text-ink-secondary transition-colors hover:bg-surface-3 hover:text-ink"
        >
          <Bell className="h-[18px] w-[18px]" />
          <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger ring-2 ring-white" />
        </button>
        <AnimatePresence>
          {notifOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-[14px] border border-border bg-white shadow-lg"
              >
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold text-ink">Notifications</p>
                  <span className="chip bg-brand-soft text-brand">3 new</span>
                </div>
                <div className="divide-y divide-border">
                  {notifications.map((n, i) => {
                    const Icon = n.icon;
                    return (
                      <div key={i} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
                        <span className={cn('mt-0.5', n.tone)}>
                          <Icon className="h-4.5 w-4.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-ink">{n.title}</p>
                          <p className="text-xs text-ink-tertiary">{n.time}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button className="w-full border-t border-border py-2.5 text-[13px] font-medium text-brand transition-colors hover:bg-surface-2">
                  View all activity
                </button>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Profile */}
      <Dropdown
        width={220}
        items={[
          {
            label: 'Profile settings',
            icon: <Settings className="h-4 w-4" />,
            onClick: () => router.push('/settings'),
          },
          { divider: true, label: '' },
          { label: 'Sign out', icon: <LogOut className="h-4 w-4" />, tone: 'danger', onClick: onLogout },
        ]}
        trigger={
          <button
            className="flex items-center gap-2 rounded-[10px] p-1 pr-1.5 transition-colors hover:bg-surface-3"
            title={profile ? `${profile.firstName} ${profile.lastName}` : undefined}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-active text-[13px] font-semibold text-white">
              {initials(profile)}
            </span>
            <ChevronDown className="hidden h-3.5 w-3.5 text-ink-tertiary sm:block" />
          </button>
        }
      />
    </header>
  );
}
