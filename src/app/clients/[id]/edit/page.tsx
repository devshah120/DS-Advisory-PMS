'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { clientsApi } from '@/lib/clients.api';
import AppShell from '@/components/layout/AppShell';
import { Skeleton, useToast } from '@/components/ui';
import ClientForm, { ClientFormValues } from '@/components/clients/ClientForm';

export default function EditClientPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const [initial, setInitial] = useState<ClientFormValues | null>(null);
  const [clientName, setClientName] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const client = await clientsApi.get(params.id);
        setClientName(client.name);
        setInitial({
          name: client.name,
          broker: client.broker,
          accountNumber: client.accountNumber,
          benchmark: client.benchmark,
          riskProfile: client.riskProfile,
          accountingMethod: client.accountingMethod,
          feeRatePercent: String(client.feeRatePercent),
          // API returns a full ISO datetime; the date input wants YYYY-MM-DD.
          inceptionDate: String(client.inceptionDate).slice(0, 10),
          currency: client.currency,
          notes: client.notes ?? '',
        });
      } catch {
        setNotFound(true);
        toast({ tone: 'error', title: 'Failed to load client' });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  return (
    <AppShell title="Edit Client" subtitle="Update this mandate's details">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={() => router.back()}
          className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        {loading && (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {!loading && notFound && (
          <p className="text-[13px] text-ink-secondary">
            This client could not be found. It may have been removed.
          </p>
        )}

        {!loading && initial && (
          <ClientForm
            mode="edit"
            initial={initial}
            lockAccountingMethod
            onCancel={() => router.back()}
            onSubmit={async (payload) => {
              const updated = await clientsApi.update(params.id, payload);
              toast({
                tone: 'success',
                title: 'Client updated',
                description: `${updated.name}'s details have been saved.`,
              });
              router.push('/clients');
            }}
          />
        )}
      </div>
    </AppShell>
  );
}
