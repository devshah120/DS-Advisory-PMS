'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PanelLeftClose, PanelLeft, ChevronRight, X } from 'lucide-react';
import { navSectionsFor, NavItem, NavSection } from '@/lib/navigation';
import { useSession } from './SessionContext';
import { BrandMark } from './BrandMark';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /** Below `lg` the sidebar is an off-canvas drawer; this is whether it is out. */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export default function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const { role } = useSession();

  const isActive = (href: string) => pathname === href;

  // Role-gated items (currently just Users) are dropped for everyone else.
  const sections = useMemo(() => navSectionsFor(role), [role]);

  // The drawer covers the page, so it locks scroll and answers Escape the way
  // the app's other overlays do.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onMobileClose();
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen, onMobileClose]);

  return (
    <>
      {/* Desktop rail — inline and collapsible. Hidden below lg, where a 264px
          column would leave a phone with almost no room for the page. */}
      <motion.aside
        animate={{ width: collapsed ? 76 : 264 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="sticky top-0 z-40 hidden h-screen shrink-0 flex-col border-r border-border bg-white lg:flex"
      >
        <SidebarBody
          sections={sections}
          isActive={isActive}
          collapsed={collapsed}
          layoutPrefix="rail"
          footer={
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
          }
        />
      </motion.aside>

      {/* Mobile / tablet drawer — never collapsed, closes on navigation (the
          shell clears `mobileOpen` when the route changes). */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-[90] lg:hidden">
            <motion.div
              className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onMobileClose}
            />
            <motion.aside
              className="absolute left-0 top-0 flex h-full w-[280px] max-w-[85vw] flex-col border-r border-border bg-white shadow-xl"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <SidebarBody
                sections={sections}
                isActive={isActive}
                collapsed={false}
                layoutPrefix="drawer"
                headerAction={
                  <button
                    onClick={onMobileClose}
                    aria-label="Close menu"
                    className="ml-auto rounded-lg p-1.5 text-ink-tertiary transition-colors hover:bg-surface-3 hover:text-ink"
                  >
                    <X className="h-5 w-5" />
                  </button>
                }
              />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

function SidebarBody({
  sections,
  isActive,
  collapsed,
  layoutPrefix,
  headerAction,
  footer,
}: {
  sections: NavSection[];
  isActive: (href: string) => boolean;
  collapsed: boolean;
  /**
   * Both the rail and the drawer are mounted at once (one hidden by CSS), so
   * their active-pill `layoutId`s must differ or framer animates between them.
   */
  layoutPrefix: string;
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <>
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center gap-3 px-4">
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
        {headerAction}
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
                layoutPrefix={layoutPrefix}
              />
            ))}
          </SidebarGroup>
        ))}
      </nav>

      {/* Footer */}
      {footer && <div className="border-t border-border p-3">{footer}</div>}
    </>
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
  layoutPrefix,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  layoutPrefix: string;
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
          layoutId={`${layoutPrefix}-sidebar-active`}
          className="absolute inset-0 rounded-[10px] bg-brand-soft"
          transition={{ type: 'spring', stiffness: 400, damping: 34 }}
        />
      )}
      {active && !collapsed && (
        <motion.span
          layoutId={`${layoutPrefix}-sidebar-active-bar`}
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
