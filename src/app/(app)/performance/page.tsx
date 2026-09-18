'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import { clientsApi } from '@/lib/clients.api';
import { familiesApi } from '@/lib/families.api';
import { Client, Family } from '@/types';
import { cn } from '@/lib/utils';
import { usePageHeading } from '@/components/layout/PageHeaderContext';
import { useMarket, useCurrency } from '@/components/layout/MarketContext';
import {
  Button,
  Dropdown,
  EmptyState,
  Select,
  Skeleton,
  useToast,
} from '@/components/ui';
import {
  PeriodPerformance,
  PeriodSheetState,
} from '@/components/performance/PeriodPerformance';
import {
  FamilyPerformance,
  FamilySheetState,
} from '@/components/performance/FamilyPerformance';
import {
  downloadFamilyPerformanceWorkbook,
  downloadPeriodPerformanceWorkbook,
} from '@/lib/performanceExport';

export default function PerformancePage() {
  const { toast } = useToast();
  const { market, ready: marketReady } = useMarket();
  const currency = useCurrency();

  const [clients, setClients] = useState<Client[] | null>(null);
  const [families, setFamilies] = useState<Family[]>([]);
  /**
   * What the sheet is measuring: one mandate, or one household.
   *
   * A single selector rather than a page-level tab, because "the Salecha family"
   * and "Prashant Salecha" are the same KIND of question asked at two levels —
   * a reviewer moves between them constantly, and a tab would make that a
   * navigation act rather than a change of subject. Encoded as one id with a
   * kind so the two can never both be set.
   */
  const [subject, setSubject] = useState<
    { kind: 'client'; id: string } | { kind: 'family'; id: string } | null
  >(null);
  const [loading, setLoading] = useState(true);

  const clientId = subject?.kind === 'client' ? subject.id : null;
  const familyId = subject?.kind === 'family' ? subject.id : null;

  /** Mirrored up from the household sheet, same contract as the client one. */
  const [familyState, setFamilyState] = useState<FamilySheetState>({
    periodReturn: null,
    loading: true,
  });

  /**
   * The period sheet's currently-loaded window, mirrored up from the child.
   *
   * The header's Export and Refresh sit above the sheet but act on what is in
   * it, and on the India path the window is chosen inside the sheet. This is
   * the minimum the header needs: what to export, and whether it is ready.
   */
  const [periodState, setPeriodState] = useState<PeriodSheetState>({
    periodReturn: null,
    asOf: null,
    loading: true,
  });
  /** Bumped by Refresh; the period sheet reloads when it changes. */
  const [periodRefresh, setPeriodRefresh] = useState(0);

  /**
   * BOTH books are on the period sheet: one view, one period selector, one
   * money-weighted headline per window.
   *
   * The fork this replaced was always meant to be temporary — the Indian book
   * was migrated first and the US book was left on the original
   * since-inception sheet "until it is migrated". Keeping it was the more
   * expensive option, because the two sheets did not merely look different,
   * they ANSWERED DIFFERENTLY: the old sheet's headline was a since-inception
   * XIRR labelled with a period name, so a US reviewer asking "how did this
   * quarter go" got the whole mandate's life de-annualized, while their Indian
   * colleague on the same screen got the actual quarter. Two desks quoting
   * incomparable numbers under one column heading is the failure the period
   * sheet exists to prevent.
   *
   * Nothing here is India-specific. The period vocabulary is generated from the
   * CLIENT'S OWN market calendar on the server (availablePeriods in
   * portfolio-reconstruction/periods.ts), so a US mandate is offered Q3 CY26 /
   * CYTD / CY25 where an Indian one is offered Q2 FY27 / FYTD / FY26 — same
   * resolver, same clamping to the client's own inception, same XIRR.
   */
  const usePeriodSheet = true;

  useEffect(() => {
    if (!marketReady) return;
    (async () => {
      try {
        /**
         * Households are fetched beside the mandates, and a failure to load
         * them is not allowed to take the page down with it: a manager with no
         * families configured, or an older deployment, must still get their
         * individual sheets. The selector simply shows no household group.
         */
        const [list, familyList] = await Promise.all([
          clientsApi.list({ limit: 200, market }),
          familiesApi.list(market).catch(() => [] as Family[]),
        ]);
        setClients(list);
        setFamilies(familyList);

        // Always select the new book's first subject rather than preserving the
        // previous id — that id belongs to the other book and would render one
        // book's performance under the other's currency.
        //
        // Households come first when the book has any, because the aggregate is
        // the level a review opens on; the individual accounts are one
        // selection away rather than the default.
        if (familyList.length) setSubject({ kind: 'family', id: familyList[0].id });
        else if (list.length) setSubject({ kind: 'client', id: list[0].id });
        else {
          setSubject(null);
          setLoading(false);
        }
      } catch {
        toast({ tone: 'error', title: 'Could not load clients' });
        setClients([]);
        setFamilies([]);
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, marketReady]);

  useEffect(() => {
    /**
     * Neither sheet is fetched here any more — the client sheet and the
     * household sheet each fetch per selected window, because the window is
     * chosen inside them. This effect only has to clear the page-level spinner
     * once a subject exists; the sheet then shows its own.
     */
    if (familyId || clientId) setLoading(false);
  }, [clientId, familyId]);

  const client = useMemo(
    () => clients?.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );
  /** Bumped by Refresh; the household sheet reloads when it changes. */
  const [familyRefresh, setFamilyRefresh] = useState(0);

  /**
   * Refresh means one thing — reload the window on screen. Both sheets fetch
   * per window, so both are reloaded through the signal they already listen on
   * rather than through a fetch owned by this page.
   */
  const refreshBusy = familyId ? familyState.loading : periodState.loading;

  const handleRefresh = useCallback(() => {
    if (familyId) {
      setFamilyRefresh((t) => t + 1);
      return;
    }
    if (!clientId) return;
    setPeriodRefresh((t) => t + 1);
  }, [clientId, familyId]);

  /**
   * Export is disabled until there is a real, computed sheet behind it. On the
   * period path that means a window whose return actually resolved: exporting a
   * period the solver could not price would produce a statement of blanks that
   * still looks like a statement.
   */
  const exportDisabled = familyId
    ? familyState.loading || !familyState.periodReturn
    : periodState.loading || !periodState.periodReturn;

  /**
   * The Performance Summary is generated HERE, in both formats, rather than
   * from a card on the Reports page. The sheet on screen already IS that
   * report — same subject, same window, same engine — so a second entry point
   * that re-asked for subject and period could only duplicate it, and could
   * disagree with it the moment the two drifted. Reports now links here.
   *
   * PDF is the client-facing statement and XLSX the working copy; which one a
   * reader wants is a property of the errand, not of the data, so both hang
   * off the one Export control rather than one being the hidden default.
   */
  const handleExport = useCallback(
    async (format: 'pdf' | 'xlsx') => {
      const name = client?.name ?? 'Client';
      try {
        if (familyId) {
          if (!familyState.periodReturn) return;
          if (format === 'pdf') {
            const { downloadFamilyPerformancePdf } = await import('@/lib/performancePdf');
            downloadFamilyPerformancePdf(familyState.periodReturn, currency);
          } else {
            await downloadFamilyPerformanceWorkbook(familyState.periodReturn, currency);
          }
        } else {
          if (!periodState.periodReturn) return;
          if (format === 'pdf') {
            const { downloadPeriodPerformancePdf } = await import('@/lib/performancePdf');
            downloadPeriodPerformancePdf(
              name,
              periodState.periodReturn,
              periodState.asOf,
              currency,
            );
          } else {
            await downloadPeriodPerformanceWorkbook(
              name,
              periodState.periodReturn,
              periodState.asOf,
              currency,
            );
          }
        }
      } catch {
        toast({ tone: 'error', title: 'Could not build the report' });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [familyId, familyState, periodState, client, currency],
  );

  usePageHeading({
    title: 'Performance',
    subtitle: familyId
      ? 'The household measured as one account, over the period you select'
      : 'Transactional XIRR, measured over the period you select',
    actions: (
      <>
        {/**
          * One selector, two groups. A household and a mandate are the same
          * question at two levels, so switching between them is a change of
          * subject in the same control rather than a move to a different page —
          * which is what makes "check the family, then check who moved it" a
          * single gesture instead of a navigation.
          *
          * The value is prefixed by kind because a family id and a client id
          * are both opaque cuids: without the prefix the page could not tell
          * which of the two lists a selection came from.
          */}
        {((clients && clients.length > 0) || families.length > 0) && (
          <Select
            value={subject ? `${subject.kind}:${subject.id}` : ''}
            onChange={(e) => {
              const [kind, id] = e.target.value.split(':');
              if (kind === 'family' || kind === 'client') setSubject({ kind, id });
            }}
            aria-label="Client or household"
          >
            {families.length > 0 && (
              <optgroup label="Households">
                {families.map((f) => (
                  <option key={f.id} value={`family:${f.id}`}>
                    {f.name} · {f.memberCount}{' '}
                    {f.memberCount === 1 ? 'account' : 'accounts'}
                  </option>
                ))}
              </optgroup>
            )}
            {clients && clients.length > 0 && (
              <optgroup label={families.length > 0 ? 'Individual accounts' : 'Accounts'}>
                {clients.map((c) => (
                  <option key={c.id} value={`client:${c.id}`}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        )}
        {/* Both books get Export and Refresh, and both now get both formats:
            the since-inception sheet was the only subject without a PDF layout,
            and it is gone. The period sheet ships the SELECTED window and says
            so on the sheet itself — the earlier objection was to a one-window
            export labelled as if it were the whole book, which the period
            workbook's own time-frame line and footnotes rule out. */}
        <Dropdown
          align="right"
          width={188}
          trigger={
            <Button
              variant="outline"
              size="md"
              leftIcon={<Download className="h-4 w-4" />}
              disabled={exportDisabled}
            >
              Export
            </Button>
          }
          items={[
            {
              label: 'Download PDF',
              icon: <FileText className="h-4 w-4" />,
              onClick: () => void handleExport('pdf'),
            },
            {
              label: 'Download Excel',
              icon: <FileSpreadsheet className="h-4 w-4" />,
              onClick: () => void handleExport('xlsx'),
            },
          ]}
        />
        <Button
          size="md"
          leftIcon={<RefreshCw className={cn('h-4 w-4', refreshBusy && 'animate-spin')} />}
          disabled={!subject || refreshBusy}
          onClick={handleRefresh}
        >
          Refresh
        </Button>
      </>
    ),
  });

  /**
   * No tabs, and no per-market fork. The old page split "Current (since
   * inception)" from "Historical (as of a date)", which forced the reader to
   * know which of two engines answered their question before they could ask it
   * — and the two reported different numbers for the same book. Since inception
   * is now simply one entry in the period dropdown, because that is all it ever
   * was, and both books read it off the same sheet.
   */
  return (
    <>
      {loading ? (
        <SheetSkeleton />
      ) : !clients?.length && !families.length ? (
        <EmptyState
          title="No clients yet"
          description="Add a client and their performance sheet appears here."
        />
      ) : familyId ? (
        <FamilyPerformance
          key={familyId}
          familyId={familyId}
          refreshSignal={familyRefresh}
          onStateChange={setFamilyState}
        />
      ) : (
        clientId && (
          <PeriodPerformance
            key={clientId}
            clientId={clientId}
            refreshSignal={periodRefresh}
            onStateChange={setPeriodState}
          />
        )
      )}
    </>
  );
}

function SheetSkeleton() {
  return (
    <div className="space-y-6">
      <div className="card p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-4 w-full max-w-lg" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-4 h-7 w-32" />
            <Skeleton className="mt-3 h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-6 h-[220px] w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
