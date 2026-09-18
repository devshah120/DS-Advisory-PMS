'use client';

import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, X, Check, AlertTriangle } from 'lucide-react';
import { holdingsApi, type LotInput } from '@/lib/holdings.api';
import { transactionsApi } from '@/lib/transactions.api';
import { Transaction } from '@/types';
import { Modal, Button, Input, Select, Badge, useToast } from '@/components/ui';
import { formatCurrency, cn } from '@/lib/utils';

/**
 * The position this modal corrects.
 *
 * Only what the editor needs to address the ledger and label itself: the
 * holding id is what the lot routes hang off, and clientId + symbol are what
 * the lot list is fetched by.
 */
export interface EditablePosition {
  id: string;
  clientId: string;
  symbol: string;
  name: string;
  ownerName: string;
  quantity: number;
  averageCostBasis: number;
}

/** One fill, as the form holds it while being edited. */
interface LotDraft {
  id: string;
  /** yyyy-mm-dd, the value a native date input round-trips without a timezone shift. */
  date: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  amount: string;
}

/**
 * A Date rendered for `<input type="date">`.
 *
 * Built from the local calendar parts rather than toISOString(), which converts
 * to UTC first and lands a trade booked in the evening on the previous day for
 * anyone east of Greenwich — the kind of silent one-day shift that would then be
 * written back to the ledger and reprice the XIRR.
 */
function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function draftFromTransaction(tx: Transaction): LotDraft {
  const quantity = Math.abs(Number(tx.quantity) || 0);
  // Older rows were written before `amount` was always populated, so the
  // consideration falls back to price x quantity rather than showing a blank
  // the user would have to retype to save anything else on the row.
  const amount = Math.abs(Number(tx.amount) || 0) || quantity * (Number(tx.price) || 0);

  return {
    id: tx.id,
    date: toDateInput(new Date(tx.date)),
    side: tx.type === 'sell' ? 'SELL' : 'BUY',
    quantity: String(quantity),
    amount: String(amount),
  };
}

/**
 * Corrects the dated fills behind one position.
 *
 * A holding in this system is a summary of its BUY/SELL transactions — the
 * Performance view's XIRR and the as-of-date export both replay them. So this
 * edits the lots rather than the position row, and the position's quantity and
 * average cost come back recomputed from the server. Editing the holding row
 * directly would fix the number in the table while leaving every return figure
 * derived from the uncorrected flows.
 *
 * That is also why the acquisition date is editable here and nowhere else: a
 * back-dated trade booked as "today" misprices the return, and the date lives
 * on the lot, not on the position.
 */
export function EditPositionModal({
  position,
  currency,
  onClose,
  onSaved,
}: {
  position: EditablePosition | null;
  currency: string;
  onClose: () => void;
  /** Fired after any write lands, so the page can refetch the book. */
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [lots, setLots] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<LotDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingLotDelete, setPendingLotDelete] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Refetched per open rather than cached: the modal is opened to correct a
  // number, and a stale list is the one thing that must not be edited.
  useEffect(() => {
    if (!position) {
      setLots([]);
      setEditingId(null);
      setDraft(null);
      setAdding(false);
      return;
    }
    let ignore = false;
    setLoading(true);
    setLoadError(null);

    transactionsApi
      .listLots(position.clientId, position.symbol)
      .then((rows) => {
        if (!ignore) setLots(rows);
      })
      .catch(() => {
        if (ignore) return;
        setLots([]);
        setLoadError('Could not load the fills behind this position.');
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [position]);

  const drafts = useMemo(() => lots.map(draftFromTransaction), [lots]);

  /**
   * What the ledger currently rebuilds to, shown live as the user types.
   *
   * Mirrors the server's replay so the footer previews the position the save
   * will produce. It is a preview only — the row the page stores afterwards is
   * always the one the server returns.
   */
  const preview = useMemo(() => {
    const rows = drafts.map((d) => (d.id === draft?.id && draft ? draft : d));
    if (draft && adding) rows.push(draft);

    let quantity = 0;
    let costBasis = 0;

    for (const r of rows) {
      const size = Math.abs(Number(r.quantity) || 0);
      const amount = Math.abs(Number(r.amount) || 0);
      if (size === 0) continue;

      if (r.side === 'BUY') {
        quantity += size;
        costBasis += amount;
      } else {
        const sold = Math.min(size, quantity);
        const averageCost = quantity > 0 ? costBasis / quantity : 0;
        quantity -= sold;
        costBasis -= averageCost * sold;
      }
    }

    return {
      quantity,
      averageCost: quantity > 0 ? costBasis / quantity : 0,
      invested: costBasis,
    };
  }, [drafts, draft, adding]);

  /**
   * True when the rebuild would move the position off what the table shows.
   *
   * Surfaced rather than hidden: the whole reason to open this modal is to
   * change those numbers, and seeing the before/after is what makes a
   * correction safe to confirm.
   */
  const willChange = useMemo(() => {
    if (!position) return false;
    return (
      Math.abs(preview.quantity - position.quantity) > 1e-6 ||
      Math.abs(preview.averageCost - position.averageCostBasis) > 1e-6
    );
  }, [position, preview]);

  function beginEdit(d: LotDraft) {
    setAdding(false);
    setEditingId(d.id);
    setDraft({ ...d });
  }

  function beginAdd() {
    if (!position) return;
    setEditingId(null);
    setAdding(true);
    setDraft({
      id: '__new__',
      date: toDateInput(new Date()),
      side: 'BUY',
      quantity: '',
      amount: '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setAdding(false);
    setDraft(null);
  }

  async function refresh() {
    if (!position) return;
    const rows = await transactionsApi.listLots(position.clientId, position.symbol);
    setLots(rows);
  }

  async function handleSaveLot() {
    if (!position || !draft) return;

    const quantity = Number(draft.quantity);
    const amount = Number(draft.amount);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      toast({ tone: 'error', title: 'Quantity must be greater than zero' });
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      toast({ tone: 'error', title: 'Amount must be zero or more' });
      return;
    }

    const input: LotInput = {
      date: draft.date,
      side: draft.side,
      quantity,
      amount,
    };

    setSaving(true);
    try {
      if (adding) {
        await holdingsApi.addLot(position.id, input);
        toast({ tone: 'success', title: 'Fill added', description: `${position.symbol} rebuilt from the ledger.` });
      } else {
        await holdingsApi.updateLot(position.id, draft.id, input);
        toast({ tone: 'success', title: 'Fill corrected', description: `${position.symbol} rebuilt from the ledger.` });
      }
      cancelEdit();
      await refresh();
      onSaved();
    } catch (err: any) {
      const message =
        err?.response?.data?.message ??
        (typeof err?.message === 'string' ? err.message : 'Save failed');
      toast({ tone: 'error', title: 'Could not save the fill', description: String(message) });
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteLot(lotId: string) {
    if (!position) return;
    setSaving(true);
    try {
      await holdingsApi.removeLot(position.id, lotId);
      setPendingLotDelete(null);
      await refresh();
      onSaved();
      toast({ tone: 'success', title: 'Fill removed', description: `${position.symbol} rebuilt from the ledger.` });
    } catch (err: any) {
      const message =
        err?.response?.data?.message ??
        (typeof err?.message === 'string' ? err.message : 'Delete failed');
      toast({ tone: 'error', title: 'Could not remove the fill', description: String(message) });
    } finally {
      setSaving(false);
    }
  }

  const editingRow = adding ? null : editingId;

  return (
    <Modal
      isOpen={!!position}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={position ? `Edit ${position.symbol}` : undefined}
      description={position ? `${position.name} · ${position.ownerName}` : undefined}
      size="2xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-ink-secondary">
            Corrections are written to the ledger; the position is rebuilt from it.
          </p>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Done
          </Button>
        </div>
      }
    >
      {position && (
        <div className="space-y-4">
          {loadError && (
            <div className="flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{loadError}</span>
            </div>
          )}

          {loading ? (
            <p className="py-6 text-center text-[13px] text-ink-secondary">Loading fills…</p>
          ) : (
            <>
              <div className="overflow-hidden rounded-[10px] border border-border">
                <table className="w-full text-[13px]">
                  <thead className="bg-surface-2 text-ink-secondary">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Date</th>
                      <th className="px-3 py-2 text-left font-medium">Side</th>
                      <th className="px-3 py-2 text-right font-medium">Quantity</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 text-right font-medium">Price</th>
                      <th className="w-[84px] px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {drafts.length === 0 && !adding && (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-ink-secondary">
                          No fills recorded against this position yet.
                        </td>
                      </tr>
                    )}

                    {drafts.map((d) => {
                      const isEditing = editingRow === d.id && draft;
                      const row = isEditing ? draft! : d;
                      const qty = Number(row.quantity) || 0;
                      const amt = Number(row.amount) || 0;

                      return (
                        <tr key={d.id} className="border-t border-border">
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <Input
                                type="date"
                                value={draft!.date}
                                onChange={(e) => setDraft({ ...draft!, date: e.target.value })}
                              />
                            ) : (
                              new Date(d.date).toLocaleDateString()
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <Select
                                value={draft!.side}
                                onChange={(e) =>
                                  setDraft({ ...draft!, side: e.target.value as 'BUY' | 'SELL' })
                                }
                              >
                                <option value="BUY">BUY</option>
                                <option value="SELL">SELL</option>
                              </Select>
                            ) : (
                              <Badge tone={d.side === 'SELL' ? 'danger' : 'success'}>{d.side}</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {isEditing ? (
                              <Input
                                type="number"
                                step="any"
                                min="0"
                                value={draft!.quantity}
                                onChange={(e) => setDraft({ ...draft!, quantity: e.target.value })}
                              />
                            ) : (
                              qty.toLocaleString(undefined, { maximumFractionDigits: 4 })
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {isEditing ? (
                              <Input
                                type="number"
                                step="any"
                                min="0"
                                value={draft!.amount}
                                onChange={(e) => setDraft({ ...draft!, amount: e.target.value })}
                              />
                            ) : (
                              formatCurrency(amt, currency)
                            )}
                          </td>
                          {/* Derived, never entered: the server computes price from
                              amount / quantity, so showing a typed price here would
                              invite the two to disagree. */}
                          <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                            {formatCurrency(qty > 0 ? amt / qty : 0, currency)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-1">
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    aria-label="Save this fill"
                                    title="Save this fill"
                                    onClick={handleSaveLot}
                                    disabled={saving}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-success transition-colors hover:bg-success-soft disabled:opacity-50"
                                  >
                                    <Check className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="Cancel"
                                    title="Cancel"
                                    onClick={cancelEdit}
                                    disabled={saving}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-ink-tertiary transition-colors hover:bg-surface-3 disabled:opacity-50"
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    aria-label="Edit this fill"
                                    title="Edit this fill"
                                    onClick={() => beginEdit(d)}
                                    disabled={saving}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-ink-tertiary transition-colors hover:bg-brand-soft hover:text-brand disabled:opacity-50"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label="Remove this fill"
                                    title="Remove this fill"
                                    onClick={() => setPendingLotDelete(d.id)}
                                    disabled={saving}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-ink-tertiary transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {adding && draft && (
                      <tr className="border-t border-border bg-brand-soft/30">
                        <td className="px-3 py-2">
                          <Input
                            type="date"
                            value={draft.date}
                            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={draft.side}
                            onChange={(e) =>
                              setDraft({ ...draft, side: e.target.value as 'BUY' | 'SELL' })
                            }
                          >
                            <option value="BUY">BUY</option>
                            <option value="SELL">SELL</option>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="Quantity"
                            value={draft.quantity}
                            onChange={(e) => setDraft({ ...draft, quantity: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            step="any"
                            min="0"
                            placeholder="Amount"
                            value={draft.amount}
                            onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                          {formatCurrency(
                            Number(draft.quantity) > 0
                              ? Number(draft.amount) / Number(draft.quantity)
                              : 0,
                            currency
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              aria-label="Add this fill"
                              title="Add this fill"
                              onClick={handleSaveLot}
                              disabled={saving}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-success transition-colors hover:bg-success-soft disabled:opacity-50"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label="Cancel"
                              title="Cancel"
                              onClick={cancelEdit}
                              disabled={saving}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-ink-tertiary transition-colors hover:bg-surface-3 disabled:opacity-50"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {!adding && (
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                  onClick={beginAdd}
                  disabled={saving}
                >
                  Add a fill
                </Button>
              )}

              {/* The position the ledger rebuilds to. Shown against what the
                  table currently holds so a correction can be checked before
                  it is confirmed rather than after. */}
              <div className="rounded-[10px] border border-border bg-surface-2 px-3 py-2.5">
                <p className="text-xs font-medium text-ink-secondary">Position after these fills</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-6 gap-y-1 text-[13px]">
                  <span>
                    <span className="text-ink-tertiary">Quantity</span>{' '}
                    <span className={cn('font-semibold tabular-nums', willChange ? 'text-brand' : 'text-ink')}>
                      {preview.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </span>
                  </span>
                  <span>
                    <span className="text-ink-tertiary">Average cost</span>{' '}
                    <span className={cn('font-semibold tabular-nums', willChange ? 'text-brand' : 'text-ink')}>
                      {formatCurrency(preview.averageCost, currency)}
                    </span>
                  </span>
                  <span>
                    <span className="text-ink-tertiary">Invested</span>{' '}
                    <span className="font-semibold tabular-nums text-ink">
                      {formatCurrency(preview.invested, currency)}
                    </span>
                  </span>
                </div>
                {willChange && (
                  <p className="mt-2 text-xs text-ink-secondary">
                    Currently {position.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })} @{' '}
                    {formatCurrency(position.averageCostBasis, currency)} — saving a fill applies the change.
                  </p>
                )}
              </div>
            </>
          )}

          {/* Removing a fill changes the position, so it is confirmed the same
              way deleting the position itself is. */}
          <Modal
            isOpen={!!pendingLotDelete}
            onClose={() => {
              if (!saving) setPendingLotDelete(null);
            }}
            title="Remove this fill?"
            description={`${position.symbol} will be rebuilt from the fills that remain.`}
            size="md"
            footer={
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={() => setPendingLotDelete(null)} disabled={saving}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  leftIcon={<Trash2 className="h-4 w-4" />}
                  onClick={() => pendingLotDelete && handleDeleteLot(pendingLotDelete)}
                  loading={saving}
                >
                  Remove fill
                </Button>
              </div>
            }
          >
            <p className="text-[13px] text-ink-secondary">
              The transaction is deleted from the ledger. Performance and any back-dated export will
              be computed without it.
            </p>
          </Modal>
        </div>
      )}
    </Modal>
  );
}
