'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import Link from 'next/link';
import { ResponsiveContainer } from '@/components/ui/ResponsiveContainer';
import { CampaignCard } from '@/components/campaigns';
import { GenericLoading } from '@/components/GenericLoading';
import { Item } from 'react-stately';
import { Select } from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import { Plus } from '@/svg_components';

interface Campaign {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  imageUrl?: string | null;
  cause: {
    id: string;
    name: string;
    icon: string | null;
    color: string | null;
  };
  org: {
    id: string;
    name: string;
    logoUrl: string | null;
  };
  _count: {
    members: number;
    actions: number;
  };
}

interface Cause {
  id: string;
  name: string;
  icon: string | null;
}

export default function CampaignsPage() {
  const [selectedCauseId, setSelectedCauseId] = useState<string | null>(null);

  // Fetch causes for filter
  const { data: causes } = useQuery<Cause[]>({
    queryKey: ['causes'],
    queryFn: async () => {
      const res = await fetch('/api/causes');
      if (!res.ok) throw new Error('Failed to fetch causes');
      return res.json();
    },
  });

  // Fetch campaigns
  const { data, isLoading, error } = useQuery<{ campaigns: Campaign[]; total: number }>({
    queryKey: ['campaigns', selectedCauseId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedCauseId) params.set('causeId', selectedCauseId);

      const res = await fetch(`/api/campaigns?${params}`);
      if (!res.ok) throw new Error('Failed to fetch campaigns');
      return res.json();
    },
  });

  if (isLoading) {
    return <GenericLoading>Loading campaigns...</GenericLoading>;
  }

  if (error) {
    return (
      <ResponsiveContainer className="py-8">
        <div className="text-center text-red-500">Failed to load campaigns. Please try again.</div>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer className="py-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-bold">Campaigns</h1>
          <p className="text-muted-foreground">
            Our Power only works when you participate. These campaigns need you. Please join.
          </p>
        </div>
        <Link href="/campaigns/create">
          <Button Icon={Plus}>Create Campaign</Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-4">
        <div className="w-64">
          <Select
            label="Filter by cause"
            name="cause"
            selectedKey={selectedCauseId}
            onSelectionChange={(key) => setSelectedCauseId(key as string | null)}>
            {[{ id: '', name: 'All causes', icon: '' }, ...(causes || [])].map((cause) => (
              <Item key={cause.id}>
                {cause.icon} {cause.name}
              </Item>
            ))}
          </Select>
        </div>
      </div>

      {/* Campaign grid */}
      {data?.campaigns && data.campaigns.length > 0 ? (
        <div className="grid gap-4">
          {data.campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))}
        </div>
      ) : (
        <div className="py-12 text-center">
          <p className="mb-2 text-lg text-muted-foreground">No campaigns found</p>
          <p className="text-sm text-muted-foreground">
            {selectedCauseId
              ? 'Try selecting a different cause or check back later.'
              : 'Check back soon for new campaigns!'}
          </p>
        </div>
      )}

      {/* Total count */}
      {data?.total && data.total > 0 && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Showing {data.campaigns.length} of {data.total} campaigns
        </p>
      )}
    </ResponsiveContainer>
  );
}
