import {
  LayoutDashboard,
  Briefcase,
  Users,
  UserCog,
  ArrowLeftRight,
  LineChart,
  Eye,
  CalendarClock,
  FileText,
  Settings,
  Gauge,
  Newspaper,
  CreditCard,
  type LucideIcon,
} from 'lucide-react';
import { isSuperAdmin, type UserRole } from '@/types';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * When set, the item is shown only if this returns true for the signed-in
   * user's role. Purely presentational — the API enforces the same rule, so a
   * hidden item is a tidier UI, never the security boundary.
   */
  visible?: (role: UserRole | null | undefined) => boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { label: 'Holdings', href: '/holdings', icon: Briefcase },
    ],
  },
  {
    title: 'Manage',
    items: [
      { label: 'Clients', href: '/clients', icon: Users },
      { label: 'Transactions', href: '/transactions', icon: ArrowLeftRight },
      // Route stays /users — renaming the path would break bookmarks and the
      // API's own /users endpoints for no gain. Only the label changed.
      { label: 'Portfolio Managers', href: '/users', icon: UserCog, visible: isSuperAdmin },
      // What managers pay the firm for their seat — trial length, plan prices
      // and the Razorpay keys. Sits next to Portfolio Managers because it
      // governs those same logins. Super Admin only, matching the API.
      { label: 'Subscription', href: '/subscription', icon: CreditCard, visible: isSuperAdmin },
    ],
  },
  {
    title: 'Insights',
    items: [
      { label: 'Watchlist', href: '/watchlist', icon: Eye },
      { label: 'Event Center', href: '/events', icon: CalendarClock },
      { label: 'News Center', href: '/news', icon: Newspaper },
      { label: 'Fundamentals', href: '/fundamentals', icon: Gauge },
      { label: 'Performance', href: '/performance', icon: LineChart },
      { label: 'Reports', href: '/reports', icon: FileText },
    ],
  },
];

export const settingsItem: NavItem = {
  label: 'Settings',
  href: '/settings',
  icon: Settings,
};

/** Flat list for command palette / search. */
export const allNavItems: NavItem[] = [
  ...navSections.flatMap((s) => s.items),
  settingsItem,
];

/** Drops the items this role isn't meant to see. */
export const visibleFor = (
  items: NavItem[],
  role: UserRole | null | undefined
): NavItem[] => items.filter((i) => !i.visible || i.visible(role));

/** Sections with their hidden items removed, and any section left empty dropped. */
export const navSectionsFor = (role: UserRole | null | undefined): NavSection[] =>
  navSections
    .map((s) => ({ ...s, items: visibleFor(s.items, role) }))
    .filter((s) => s.items.length > 0);
