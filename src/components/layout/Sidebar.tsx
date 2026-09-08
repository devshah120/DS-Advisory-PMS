'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PanelLeftClose, PanelLeft, ChevronRight } from 'lucide-react';
import { navSectionsFor, settingsItem, NavItem } from '@/lib/navigation';
import { useSession } from './SessionContext';
import { BrandMark } from './BrandMark';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { role } = useSession();

  const isActive = (href: string) => pathname === href;

  // Role-gated items (currently just Users) are dropped for everyone else.
  const sections = useMemo(() => navSectionsFor(role), [role]);

  return (
    <motion.aside
      animate={{ width: collapsed ? 76 : 264 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="sticky top-0 z-40 flex h-screen flex-col border-r border-border bg-white"
    >
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 px-4">
        <BrandMark size={36} />
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="min-w-0"
            >
              <p className="truncate text-[15px] font-semibold tracking-tight text-ink">Giriraj Global Consultants</p>
              <p className="truncate text-[11px] text-ink-tertiary">Equity &amp; ETF Advisory</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Scroll area */}
      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {sections.map((section) => (
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
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-3">
        <button
          onClick={onToggle}
          className={cn(
            'flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-[13px] font-medium text-ink-tertiary transition-colors hover:bg-surface-3 hover:text-ink',
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
