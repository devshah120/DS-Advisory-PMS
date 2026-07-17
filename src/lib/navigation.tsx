import {
  LayoutDashboard,
  Briefcase,
  Users,
  ArrowLeftRight,
  LineChart,
  Eye,
  FileText,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
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
    ],
  },
  {
    title: 'Insights',
    items: [
      { label: 'Performance', href: '/performance', icon: LineChart },
      { label: 'Watchlist', href: '/watchlist', icon: Eye },
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
