'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PanelLeftClose,
  PanelLeft,
  Search,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { navSections, settingsItem, allNavItems, NavItem } from '@/lib/navigation';
import { cn } from '@/lib/utils';

interface SidebarProps {
  onLogout: () => void;
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ onLogout, collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const isActive = (href: string) => pathname === href;

  const filtered = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return allNavItems.filter((i) => i.label.toLowerCase().includes(q));
  }, [query]);

  return (
    <motion.aside
      animate={{ width: collapsed ? 76 : 264 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="sticky top-0 z-40 flex h-screen flex-col border-r border-border bg-white"
    >
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand to-brand-active shadow-sm">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none">
            <path
              d="M12 3L4 7.5v9L12 21l8-4.5v-9L12 3z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M12 3v18M4 7.5l8 4.5 8-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="min-w-0"
            >
              <p className="truncate text-[15px] font-semibold tracking-tight text-ink">DS Advisory</p>
              <p className="truncate text-[11px] text-ink-tertiary">Institutional</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-tertiary" />
            <input
              type="search"
              name="sidebar-nav-search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              readOnly={!searchFocused}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search navigation"
              className="h-9 w-full rounded-[10px] border border-border bg-surface-2 pl-9 pr-3 text-[13px] text-ink placeholder:text-ink-tertiary focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand/15"
            />
          </div>
        </div>
      )}

      {/* Scroll area */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {filtered ? (
          <SidebarGroup collapsed={collapsed} title="Results">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[13px] text-ink-tertiary">No matches</p>
            ) : (
              filtered.map((item) => (
                <SidebarLink key={item.label} item={item} active={isActive(item.href)} collapsed={collapsed} />
              ))
            )}
          </SidebarGroup>
        ) : (
          <>
            {navSections.map((section) => (
              <SidebarGroup key={section.title} collapsed={collapsed} title={section.title}>
                {section.items.map((item) => (
                  <SidebarLink
                    key={section.title + item.label}
                    item={item}
                    active={isActive(item.href)}
                    collapsed={collapsed}
                  />
                ))}
              </SidebarGroup>
            ))}

            <div className="space-y-0.5">
              <SidebarLink
                item={settingsItem}
                active={isActive(settingsItem.href)}
                collapsed={collapsed}
              />
            </div>
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3">
        <button
          onClick={onLogout}
          className={cn(
            'mt-1 flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-danger-soft hover:text-danger',
            collapsed && 'justify-center px-0'
          )}
        >
          <LogOut className="h-4.5 w-4.5 shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>

        <button
          onClick={onToggle}
          className={cn(
            'mt-2 flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-[13px] font-medium text-ink-tertiary transition-colors hover:bg-surface-3 hover:text-ink',
            collapsed && 'justify-center px-0'
          )}
        >
          {collapsed ? (
            <PanelLeft className="h-4.5 w-4.5" />
          ) : (
            <>
              <PanelLeftClose className="h-4.5 w-4.5" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </motion.aside>
  );
}

function SidebarGroup({
  title,
  icon,
  collapsed,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      {!collapsed && (
        <div className="mb-1 flex items-center gap-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-ink-tertiary">
          {icon}
          {title}
        </div>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SidebarLink({
  item,
  active,
  collapsed,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13.5px] font-medium transition-colors',
        active ? 'text-brand' : 'text-ink-secondary hover:bg-surface-3 hover:text-ink',
        collapsed && 'justify-center px-0'
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          className="absolute inset-0 rounded-[10px] bg-brand-soft"
          transition={{ type: 'spring', stiffness: 400, damping: 34 }}
        />
      )}
      {active && !collapsed && (
        <motion.span
          layoutId="sidebar-active-bar"
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand"
          transition={{ type: 'spring', stiffness: 400, damping: 34 }}
        />
      )}
      <Icon className="relative z-10 h-[18px] w-[18px] shrink-0" />
      {!collapsed && <span className="relative z-10 flex-1 truncate">{item.label}</span>}
      {!collapsed && active && (
        <ChevronRight className="relative z-10 h-3.5 w-3.5 text-brand/60" />
      )}
    </Link>
  );
}
