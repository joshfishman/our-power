'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ResponsiveContainer } from '@/components/ui/ResponsiveContainer';
import { GenericLoading } from '@/components/GenericLoading';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useToast } from '@/hooks/useToast';
import { useDialogs } from '@/hooks/useDialogs';
import { BuildingBusinessOffice, Plus, Trash, Globe } from '@/svg_components';

interface Manager {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

interface Campaign {
  id: string;
  name: string;
  status: string;
  _count: {
    members: number;
    actions: number;
  };
}

interface Organization {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  website: string | null;
  managers: Manager[];
  campaigns: Campaign[];
  _count: {
    campaigns: number;
  };
}

export default function OrganizationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { confirm } = useDialogs();
  const [newManagerEmail, setNewManagerEmail] = useState('');
  const [showAddManager, setShowAddManager] = useState(false);

  const {
    data: org,
    isLoading,
    error,
  } = useQuery<Organization>({
    queryKey: ['organization', params.id],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${params.id}`);
      if (!res.ok) throw new Error('Failed to fetch organization');
      return res.json();
    },
  });

  // Check if current user is a manager
  const { data: managedOrgs } = useQuery<Organization[]>({
    queryKey: ['organizations', 'managed'],
    queryFn: async () => {
      const res = await fetch('/api/organizations?managed=true');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
  });

  const isManager = managedOrgs?.some((o) => o.id === params.id);

  const addManagerMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch(`/api/organizations/${params.id}/managers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: email }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to add manager');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization', params.id] });
      showToast({ type: 'success', title: 'Manager added!' });
      setNewManagerEmail('');
      setShowAddManager(false);
    },
    onError: (error) => {
      showToast({ type: 'error', title: 'Failed to add manager', message: error.message });
    },
  });

  const removeManagerMutation = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/organizations/${params.id}/managers?userId=${userId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to remove manager');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization', params.id] });
      showToast({ type: 'success', title: 'Manager removed' });
    },
    onError: (error) => {
      showToast({ type: 'error', title: 'Failed to remove manager', message: error.message });
    },
  });

  const deleteOrgMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/organizations/${params.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete organization');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      showToast({ type: 'success', title: 'Organization deleted' });
      router.push('/organizations');
    },
    onError: (error) => {
      showToast({ type: 'error', title: 'Failed to delete', message: error.message });
    },
  });

  if (isLoading) return <GenericLoading>Loading organization...</GenericLoading>;

  if (error || !org) {
    return (
      <ResponsiveContainer className="py-8">
        <div className="text-center text-red-500">Organization not found</div>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer className="py-6">
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        {org.logoUrl ? (
          <Image
            src={org.logoUrl}
            alt={org.name}
            width={64}
            height={64}
            className="h-16 w-16 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10">
            <BuildingBusinessOffice className="h-8 w-8 text-primary" />
          </div>
        )}
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{org.name}</h1>
          {org.description && <p className="mt-1 text-muted-foreground">{org.description}</p>}
          {org.website && (
            <a
              href={org.website}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline">
              <Globe className="h-4 w-4" />
              {org.website}
            </a>
          )}
        </div>
        {isManager && (
          <div className="flex gap-2">
            <Link href={`/campaigns/create?orgId=${org.id}`}>
              <Button Icon={Plus}>New Campaign</Button>
            </Link>
          </div>
        )}
      </div>

      {/* Managers Section */}
      <section className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Managers ({org.managers.length})</h2>
          {isManager && (
            <Button size="small" mode="subtle" onPress={() => setShowAddManager(!showAddManager)}>
              {showAddManager ? 'Cancel' : 'Add Manager'}
            </Button>
          )}
        </div>

        {showAddManager && (
          <div className="mb-4 flex gap-2 rounded-lg border border-border bg-card p-4">
            <TextInput
              name="email"
              placeholder="Enter user email"
              value={newManagerEmail}
              onChange={(e) => setNewManagerEmail(e.target.value)}
              className="flex-1"
            />
            <Button
              onPress={() => addManagerMutation.mutate(newManagerEmail)}
              loading={addManagerMutation.isPending}
              isDisabled={!newManagerEmail.trim()}>
              Add
            </Button>
          </div>
        )}

        <div className="space-y-2">
          {org.managers.map((manager) => (
            <div key={manager.id} className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="flex items-center gap-3">
                {manager.image ? (
                  <Image
                    src={manager.image}
                    alt=""
                    width={32}
                    height={32}
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm">
                    {(manager.name || 'U')[0]}
                  </div>
                )}
                <div>
                  <p className="font-medium">{manager.name || 'Unknown'}</p>
                  <p className="text-sm text-muted-foreground">{manager.email}</p>
                </div>
              </div>
              {isManager && org.managers.length > 1 && (
                <Button
                  size="small"
                  mode="subtle"
                  Icon={Trash}
                  onPress={() =>
                    confirm({
                      title: 'Remove Manager',
                      message: `Remove ${manager.name || 'this user'} as a manager?`,
                      onConfirm: () => removeManagerMutation.mutate(manager.id),
                    })
                  }
                />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Campaigns Section */}
      <section className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Campaigns ({org._count.campaigns})</h2>
        </div>

        {org.campaigns.length > 0 ? (
          <div className="space-y-3">
            {org.campaigns.map((campaign) => (
              <Link
                key={campaign.id}
                href={`/campaigns/${campaign.id}`}
                className="flex items-center justify-between rounded-lg border border-border p-4 transition-colors hover:bg-muted/50">
                <div>
                  <h3 className="font-medium">{campaign.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {campaign._count.members} members · {campaign._count.actions} actions
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-1 text-xs font-medium ${
                    campaign.status === 'ACTIVE'
                      ? 'bg-sky-500/10 text-sky-500'
                      : campaign.status === 'DRAFT'
                      ? 'bg-yellow-500/10 text-yellow-500'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                  {campaign.status}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border py-8 text-center">
            <p className="text-muted-foreground">No campaigns yet</p>
            {isManager && (
              <Link href={`/campaigns/create?orgId=${org.id}`}>
                <Button className="mt-4" mode="subtle" Icon={Plus}>
                  Create First Campaign
                </Button>
              </Link>
            )}
          </div>
        )}
      </section>

      {/* Danger Zone */}
      {isManager && (
        <section className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <h2 className="mb-2 text-lg font-semibold text-red-500">Danger Zone</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Deleting this organization will also delete all its campaigns and actions.
          </p>
          <Button
            mode="subtle"
            className="border-red-500 text-red-500 hover:bg-red-500/10"
            onPress={() =>
              confirm({
                title: 'Delete Organization',
                message: 'Are you sure? This action cannot be undone.',
                onConfirm: () => deleteOrgMutation.mutate(),
              })
            }>
            Delete Organization
          </Button>
        </section>
      )}
    </ResponsiveContainer>
  );
}
