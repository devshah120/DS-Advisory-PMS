import type { ReactNode } from 'react';
import AppShell from '@/components/layout/AppShell';

/**
 * Renders the application chrome once for every authenticated route.
 *
 * Because this layout sits above the pages, Next keeps it mounted across
 * navigation — the Header and Sidebar are no longer torn down and rebuilt on
 * each menu click, so the profile and client list are fetched once per session.
 *
 * Pages set their own title/subtitle/actions with `usePageHeading`.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
