'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer } from '@/components/ui/ResponsiveContainer';
import { OrganizationCard, CreateOrganizationForm } from '@/components/organizations';
import { GenericLoading } from '@/components/GenericLoading';
import Button from '@/components/ui/Button';
import { ActionsPlus } from '@/svg_components';

interface Organization {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  website: string | null;
  managers: {
    id: string;
    name: string | null;
    image: string | null;
  }[];
  _count: {
    campaigns: number;
  };
}

export default function OrganizationsPage() {
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Fetch all organizations
  const { data: allOrgs, isLoading: loadingAll } = useQuery<Organization[]>({
    queryKey: ['organizations'],
    queryFn: async () => {
      const res = await fetch('/api/organizations');
      if (!res.ok) throw new Error('Failed to fetch organizations');
      return res.json();
    },
  });

  // Fetch organizations the user manages
  const { data: managedOrgs, isLoading: loadingManaged } = useQuery<Organization[]>({
    queryKey: ['organizations', 'managed'],
    queryFn: async () => {
      const res = await fetch('/api/organizations?managed=true');
      if (!res.ok) throw new Error('Failed to fetch managed organizations');
      return res.json();
    },
  });

  const isLoading = loadingAll || loadingManaged;
  const managedIds = new Set(managedOrgs?.map((org) => org.id) || []);

  if (isLoading) {
    return <GenericLoading>Loading organizations...</GenericLoading>;
  }

  return (
    <ResponsiveContainer className="py-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-bold">Organizations</h1>
          <p className="text-muted-foreground">Manage organizations and create campaigns.</p>
        </div>
        <Button onPress={() => setShowCreateForm(!showCreateForm)} Icon={ActionsPlus}>
          {showCreateForm ? 'Cancel' : 'New Organization'}
        </Button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="mb-8 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Create New Organization</h2>
          <CreateOrganizationForm
            onSuccess={() => setShowCreateForm(false)}
            onCancel={() => setShowCreateForm(false)}
          />
        </div>
      )}

      {/* My Organizations Section */}
      {managedOrgs && managedOrgs.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 text-lg font-semibold">My Organizations</h2>
          <div className="grid gap-4">
            {managedOrgs.map((org) => (
              <OrganizationCard key={org.id} organization={org} isManager />
            ))}
          </div>
        </section>
      )}

      {/* All Organizations Section */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">All Organizations</h2>
        {allOrgs && allOrgs.length > 0 ? (
          <div className="grid gap-4">
            {allOrgs
              .filter((org) => !managedIds.has(org.id))
              .map((org) => (
                <OrganizationCard key={org.id} organization={org} />
              ))}
          </div>
        ) : (
          <div className="py-12 text-center">
            <p className="mb-2 text-lg text-muted-foreground">No organizations yet</p>
            <p className="text-sm text-muted-foreground">Create the first one to get started!</p>
          </div>
        )}
      </section>
    </ResponsiveContainer>
  );
}
