'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { clientsApi } from '@/lib/clients.api';
import { usePageHeading } from '@/components/layout/PageHeaderContext';
import { useMarket } from '@/components/layout/MarketContext';
import { useToast } from '@/components/ui';
import ClientForm, { emptyClientForm } from '@/components/clients/ClientForm';

export default function AddClientPage() {
  const { market, meta } = useMarket();

  usePageHeading({
    title: 'New Client',
    // Naming the book here is what stops a mandate being filed under the wrong
    // one: the form has no country field, so the header selector is the only
    // thing that decides it, and it's off in the corner of the screen.
    subtitle: `Onboard a new mandate to the ${meta.label} book (${meta.currency})`,
  });

  const router = useRouter();
  const { toast } = useToast();

  return (
    <>
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
            // The book comes from the header selector, not a form field — a
            // client created while viewing India is an Indian mandate, and the
            // server derives its currency (INR) from this.
            const created = await clientsApi.create({ ...payload, market });
            toast({
              tone: 'success',
              title: 'Client created',
              description: `${created.name} has been added to the ${meta.label} book.`,
            });
            router.push('/clients');
          }}
        />
      </div>
    </>
  );
}
