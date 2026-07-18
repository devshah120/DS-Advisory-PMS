'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { clientsApi } from '@/lib/clients.api';
import AppShell from '@/components/layout/AppShell';
import { useToast } from '@/components/ui';
import ClientForm, { emptyClientForm } from '@/components/clients/ClientForm';

export default function AddClientPage() {
  const router = useRouter();
  const { toast } = useToast();

  return (
    <AppShell title="New Client" subtitle="Onboard a new mandate to the platform">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={() => router.back()}
          className="mb-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <ClientForm
          mode="create"
          initial={emptyClientForm}
          onCancel={() => router.back()}
          onSubmit={async (payload) => {
            const created = await clientsApi.create(payload);
            toast({
              tone: 'success',
              title: 'Client created',
              description: `${created.name} has been added.`,
            });
            router.push('/clients');
          }}
        />
      </div>
    </AppShell>
  );
}
