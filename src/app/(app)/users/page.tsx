'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash2, ShieldCheck, Lock } from 'lucide-react';
import {
  usersApi,
  type StaffUser,
  type CreateUserInput,
  type AdminUpdateUserInput,
} from '@/lib/users.api';
import { parseApiError } from '@/lib/clients.api';
import { ROLE_LABELS, isSuperAdmin, type UserRole } from '@/types';
import { usePageHeading } from '@/components/layout/PageHeaderContext';
import {
  Card,
  Badge,
  Button,
  DataTable,
  Modal,
  Input,
  EmptyState,
  Skeleton,
  useToast,
  type Column,
} from '@/components/ui';

const roleTone: Record<UserRole, 'brand' | 'info' | 'neutral'> = {
  super_admin: 'brand',
  admin: 'brand',
  portfolio_manager: 'info',
  research_analyst: 'neutral',
  viewer: 'neutral',
};

/** Blank new-user form. Portfolio Manager is the role this screen exists to create. */
const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  organization: '',
  role: 'portfolio_manager' as UserRole,
  active: true,
};

type FormState = typeof EMPTY_FORM;

export default function UsersPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  // null = still resolving the caller's own role; false = not permitted.
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [meId, setMeId] = useState<string | null>(null);

  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<StaffUser | null>(null);

  const openCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setFormErrors({});
    setEditing(null);
    setCreating(true);
  }, []);

  usePageHeading({
    title: 'Portfolio Managers',
    subtitle: 'Manager logins and the books they run',
    actions: allowed ? (
      <Button leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
        Add Portfolio Manager
      </Button>
    ) : null,
  });

  // The route is only linked in the sidebar for a Super Admin, but a URL can be
  // typed. The list request would 403 on its own; resolving the role first lets
  // us show an explanation instead of a failed-to-load error.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await usersApi.getProfile();
      setMeId(me.id);

      if (!isSuperAdmin(me.role)) {
        setAllowed(false);
        return;
      }

      setAllowed(true);
      // This screen lists the firm's PORTFOLIO MANAGERS. The API returns every
      // staff row, so the two kinds that are not managers are dropped here:
      //
      //   · VIEWER — client-portal logins. They belong to their Client record
      //     and are created and deleted with it (see ClientsService), so they
      //     were only ever read-only rows here.
      //   · SUPER_ADMIN / ADMIN — administrators, not a book of business. The
      //     tier is provisioned by script and cannot be created or edited from
      //     this screen anyway.
      //
      // Filtered at load rather than in `columns` so every consumer of `users`
      // — the table, the search, the row count — agrees on one list.
      const staff = await usersApi.listUsers();
      setUsers(staff.filter((u) => u.role === 'portfolio_manager' || u.role === 'research_analyst'));
    } catch (err) {
      toast({ tone: 'error', title: parseApiError(err).message });
      setAllowed(false);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = (user: StaffUser) => {
    setForm({
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      // Blank means "leave the password alone" — this field is a reset, and an
      // edit that doesn't touch it must not clear the user's existing login.
      password: '',
      organization: user.organization ?? '',
      role: user.role,
      active: user.active,
    });
    setFormErrors({});
    setCreating(false);
    setEditing(user);
  };

  const closeForm = () => {
    setCreating(false);
    setEditing(null);
  };

  const setF = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setFormErrors((e) => (e[k as string] ? { ...e, [k as string]: '' } : e));
  };

  /** Mirrors the DTO rules so obvious mistakes never make a round trip. */
  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.firstName.trim()) errs.firstName = 'First name is required';
    if (!form.lastName.trim()) errs.lastName = 'Last name is required';
    if (!form.email.trim()) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      errs.email = 'Enter a valid email address';

    // Required when creating; optional when editing, where blank means unchanged.
    if (creating && form.password.length < 8)
      errs.password = 'Password must be at least 8 characters';
    else if (!creating && form.password && form.password.length < 8)
      errs.password = 'Password must be at least 8 characters';

    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (creating) {
        const payload: CreateUserInput = {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
          // `role` is not sent: the API creates a Portfolio Manager either way.
          active: form.active,
          ...(form.organization.trim() && { organization: form.organization.trim() }),
        };
        const created = await usersApi.createUser(payload);
        setUsers((prev) => [created, ...prev]);
        toast({
          tone: 'success',
          title: `${created.firstName} ${created.lastName} added as ${created.roleLabel}`,
        });
      } else if (editing) {
        // Send only what actually changed, so an untouched field can never be
        // rewritten by a stale value sitting in the form.
        const patch: AdminUpdateUserInput = {};
        if (form.firstName.trim() !== editing.firstName)
          patch.firstName = form.firstName.trim();
        if (form.lastName.trim() !== editing.lastName)
          patch.lastName = form.lastName.trim();
        if (form.email.trim().toLowerCase() !== editing.email)
          patch.email = form.email.trim().toLowerCase();
        if (form.organization.trim() !== (editing.organization ?? ''))
          patch.organization = form.organization.trim();
        // `role` is deliberately never patched: it is no longer editable here,
        // and sending it would let an edit demote the Super Admin or flip a
        // client-portal login into staff via a stale form value.
        if (form.active !== editing.active) patch.active = form.active;
        if (form.password) patch.password = form.password;

        if (Object.keys(patch).length === 0) {
          closeForm();
          return;
        }

        const updated = await usersApi.adminUpdateUser(editing.id, patch);
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
        toast({ tone: 'success', title: 'User updated' });
      }
      closeForm();
    } catch (err) {
      const { message, fields } = parseApiError(err);
      if (fields && Object.keys(fields).length) setFormErrors(fields);
      else toast({ tone: 'error', title: message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    try {
      await usersApi.deleteUser(target.id);
      setUsers((prev) => prev.filter((u) => u.id !== target.id));
      toast({ tone: 'success', title: `${target.firstName} ${target.lastName} removed` });
    } catch (err) {
      toast({ tone: 'error', title: parseApiError(err).message });
    }
  };

  const columns: Column<StaffUser>[] = useMemo(
    () => [
      {
        key: 'name',
        header: 'Name',
        accessor: (u) => `${u.firstName} ${u.lastName}`,
        render: (u) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">
              {u.firstName} {u.lastName}
              {u.id === meId && (
                <span className="ml-2 text-[12px] font-normal text-ink-tertiary">You</span>
              )}
            </p>
            <p className="truncate text-[12.5px] text-ink-tertiary">{u.email}</p>
          </div>
        ),
      },
      {
        key: 'role',
        header: 'Role',
        accessor: (u) => u.roleLabel,
        render: (u) => <Badge tone={roleTone[u.role] ?? 'neutral'}>{u.roleLabel}</Badge>,
      },
      {
        key: 'organization',
        header: 'Organization',
        accessor: (u) => u.organization ?? '—',
      },
      {
        key: 'status',
        header: 'Status',
        accessor: (u) => (u.active ? 'Active' : 'Deactivated'),
        render: (u) => (
          <Badge tone={u.active ? 'success' : 'neutral'} dot>
            {u.active ? 'Active' : 'Deactivated'}
          </Badge>
        ),
      },
      {
        key: 'actions',
        header: '',
        meta: true,
        align: 'right',
        accessor: () => '',
        render: (u) =>
          u.isClientLogin ? (
            // Owned by the Client record that created it; editing it here would
            // desynchronise the two, so this screen only displays it.
            <span
              className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-tertiary"
              title="Client portal login — manage it from the client record"
            >
              <Lock className="h-3.5 w-3.5" />
              Client login
            </span>
          ) : (
            <div className="flex items-center justify-end gap-1">
              <button
                onClick={() => openEdit(u)}
                title="Edit user"
                className="rounded-lg p-2 text-ink-tertiary transition-colors hover:bg-surface-3 hover:text-ink"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => setConfirmDelete(u)}
                disabled={u.id === meId}
                title={u.id === meId ? 'You cannot delete your own account' : 'Delete user'}
                className="rounded-lg p-2 text-ink-tertiary transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-tertiary"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ),
      },
    ],
    [meId]
  );

  if (loading || allowed === null) {
    return (
      <Card>
        <Skeleton className="h-8 w-48" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (!allowed) {
    return (
      <Card>
        <EmptyState
          icon={<ShieldCheck className="h-6 w-6" />}
          title="Super Admin access required"
          description="Only a Super Admin can manage portfolio manager logins."
          action={
            <Button variant="secondary" onClick={() => router.push('/dashboard')}>
              Back to Dashboard
            </Button>
          }
        />
      </Card>
    );
  }

  const formOpen = creating || editing !== null;

  return (
    <>
      <Card>
        <DataTable
          columns={columns}
          data={users}
          rowKey={(u) => u.id}
          searchPlaceholder="Search portfolio managers…"
          searchKeys={(u) => `${u.firstName} ${u.lastName} ${u.email} ${u.roleLabel}`}
          emptyTitle="No portfolio managers yet"
          emptyDescription="Add a Portfolio Manager to get started."
        />
      </Card>

      <Modal
        isOpen={formOpen}
        onClose={closeForm}
        size="xl"
        title={creating ? 'Add Portfolio Manager' : 'Edit account'}
        description={
          creating
            ? 'Create a manager login. They start with no clients — assign mandates to them from the client form.'
            : 'Update this account’s details or access.'
        }
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saving}>
              {creating ? 'Create Portfolio Manager' : 'Save changes'}
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Input
            label="First Name"
            value={form.firstName}
            error={formErrors.firstName || undefined}
            onChange={(e) => setF('firstName', e.target.value)}
          />
          <Input
            label="Last Name"
            value={form.lastName}
            error={formErrors.lastName || undefined}
            onChange={(e) => setF('lastName', e.target.value)}
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            error={formErrors.email || undefined}
            onChange={(e) => setF('email', e.target.value)}
          />
          <Input
            label="Organization"
            value={form.organization}
            error={formErrors.organization || undefined}
            onChange={(e) => setF('organization', e.target.value)}
          />
          <Input
            label={creating ? 'Password' : 'Reset password'}
            type="password"
            autoComplete="new-password"
            value={form.password}
            error={formErrors.password || undefined}
            helper={
              creating
                ? 'At least 8 characters.'
                : 'Leave blank to keep the current password.'
            }
            onChange={(e) => setF('password', e.target.value)}
          />
          {/*
            Role is fixed, not chosen. This screen creates Portfolio Managers and
            nothing else, so a selector would only offer ways to get it wrong —
            `form.role` stays 'portfolio_manager' from EMPTY_FORM and is sent as
            such. Read-only rather than hidden so an EDIT still shows the truth:
            the list also contains client-portal logins (Viewer) and the Super
            Admin, and a blank space there would read as "no role".

            Super Admin remains unassignable from any UI — the API's
            ASSIGNABLE_ROLES check rejects it regardless of what is posted.
          */}
          <Input
            label="Role"
            value={editing ? editing.roleLabel : ROLE_LABELS.portfolio_manager}
            readOnly
            disabled
            helper={
              editing
                ? 'A role cannot be changed here.'
                : 'Full access to their own clients, transactions, and reporting.'
            }
          />

          <div className="md:col-span-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-border p-3.5 transition-colors hover:bg-surface-2">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setF('active', e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border text-brand focus:ring-brand/25"
              />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-ink">
                  Account active
                </span>
                <span className="block text-[12.5px] text-ink-tertiary">
                  Deactivating signs the user out and blocks them from signing in
                  again, without deleting their history.
                </span>
              </span>
            </label>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        size="sm"
        title="Delete user"
        description={
          confirmDelete
            ? `${confirmDelete.firstName} ${confirmDelete.lastName} will lose access immediately. This cannot be undone.`
            : undefined
        }
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Delete user
            </Button>
          </div>
        }
      >
        <p className="text-[13.5px] text-ink-secondary">
          Consider deactivating the account instead — it revokes access just as
          quickly but keeps the record intact.
        </p>
      </Modal>
    </>
  );
}
