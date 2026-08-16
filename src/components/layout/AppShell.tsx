'use client';

import { ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { apiClient } from '@/lib/api';
import Sidebar from './Sidebar';
import Header from './Header';
import { CommandPalette } from './CommandPalette';
import { PageHeaderProvider, usePageHeader } from './PageHeaderContext';
import { MarketProvider } from './MarketContext';
import { SessionProvider } from './SessionContext';

/**
 * The persistent application chrome: sidebar, header, command palette.
 *
 * Rendered once by the (app) route-group layout and kept mounted across
 * navigation, so the Header no longer refetches the profile and client list on
 * every menu click. Pages declare their own heading with `usePageHeading`
 * instead of wrapping themselves in this component.
 */
export default function AppShell({
  children,
  requireAuth = true,
}: {
  children: ReactNode;
  requireAuth?: boolean;
}) {
  // MarketProvider sits outside PageHeaderProvider so the selected book is in
  // scope for the Header (which renders the selector) and for every page at
  // once — the selection has to outlive navigation between them.
  // SessionProvider is outermost: the signed-in user's role decides which nav
  // items the Sidebar renders, and both it and the Header read the same profile.
  return (
    <SessionProvider>
      <MarketProvider>
        <PageHeaderProvider>
          <AppShellInner requireAuth={requireAuth}>{children}</AppShellInner>
        </PageHeaderProvider>
      </MarketProvider>
    </SessionProvider>
  );
}

function AppShellInner({
  children,
  requireAuth,
}: {
  children: ReactNode;
  requireAuth: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // `title`/`subtitle` come from state so a change re-renders the shell;
  // `actions` is read live so the buttons always hold the page's current
  // handlers rather than the ones captured when the heading last changed.
  const { title, subtitle, ref: headingRef } = usePageHeader();
  const actions = headingRef.current.actions;
  const [ready, setReady] = useState(!requireAuth);
  const [collapsed, setCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    if (!requireAuth) return;
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (!token) {
      router.replace('/auth/login');
      return;
    }
    setReady(true);
  }, [requireAuth, router]);

  // ⌘K / Ctrl+K command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Restore collapse preference
  useEffect(() => {
    const saved = localStorage.getItem('atlas:sidebar-collapsed');
    if (saved) setCollapsed(saved === '1');
  }, []);

  const toggleCollapse = () => {
    setCollapsed((c) => {
      localStorage.setItem('atlas:sidebar-collapsed', c ? '0' : '1');
      return !c;
    });
  };

  const handleLogout = async () => {
    // Drop the server-side session first, so this device stops appearing under
    // Settings > Security > Active Sessions. Best-effort: if the call fails we
    // still sign out locally rather than trapping the user in the app.
    const refreshToken = apiClient.getRefreshToken();
    if (refreshToken) {
      try {
        await apiClient.getClient().post('/auth/logout', { refreshToken });
      } catch {
        // Ignore — clearing the tokens below is what the user asked for.
      }
    }

    apiClient.clearTokens();
    router.push('/auth/login');
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-app">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand" />
          <p className="text-[13px] text-ink-tertiary">Loading Giriraj Global Capital…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-app">
      <Sidebar onLogout={handleLogout} collapsed={collapsed} onToggle={toggleCollapse} />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenCommand={() => setCmdOpen(true)} onLogout={handleLogout} />

        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full min-w-0 max-w-[1440px] px-6 py-7 lg:px-8">
            {(title || actions) && (
              <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
                <div>
                  {title && (
                    <h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
                  )}
                  {subtitle && (
                    <p className="mt-1 text-[14px] text-ink-secondary">{subtitle}</p>
                  )}
                </div>
                {actions && <div className="flex items-center gap-3">{actions}</div>}
              </div>
            )}
            {/* Keyed on the route so the enter animation replays per page — it
                used to come free with the remount this layout now avoids. */}
            <motion.div
              key={pathname}
              className="min-w-0"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              {children}
            </motion.div>
          </div>
        </main>
      </div>

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
