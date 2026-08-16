'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usersApi, type UserProfile } from '@/lib/users.api';
import { isSuperAdmin, type UserRole } from '@/types';

/**
 * The signed-in user, fetched once for the whole shell.
 *
 * Both the Header (avatar, initials) and the Sidebar (which nav items to show)
 * need the profile, and the Sidebar needs the role specifically to decide
 * whether the Users item appears. Holding it here keeps that to one request
 * instead of one per consumer, and keeps the two in agreement.
 *
 * Hiding a nav item is presentation only — every restricted route is enforced
 * by the API and re-checked by the page itself.
 */
interface SessionValue {
  profile: UserProfile | null;
  role: UserRole | null;
  /** False until the first fetch settles, so consumers can avoid flicker. */
  ready: boolean;
  isSuperAdmin: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  profile: null,
  role: null,
  ready: false,
  isSuperAdmin: false,
  refresh: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setProfile(await usersApi.getProfile());
    } catch {
      // Left null: the shell still renders, the avatar falls back to a
      // placeholder, and role-gated items simply stay hidden. A toast here
      // would fire on every page that mounts the shell.
      setProfile(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<SessionValue>(
    () => ({
      profile,
      role: profile?.role ?? null,
      ready,
      isSuperAdmin: isSuperAdmin(profile?.role),
      refresh,
    }),
    [profile, ready, refresh]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const useSession = () => useContext(SessionContext);
