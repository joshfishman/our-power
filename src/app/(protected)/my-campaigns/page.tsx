'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ResponsiveContainer } from '@/components/ui/ResponsiveContainer';
import { CampaignCard } from '@/components/campaigns';
import { GenericLoading } from '@/components/GenericLoading';
import Button from '@/components/ui/Button';

interface MyCampaign {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  imageUrl?: string | null;
  joinedAt: string;
  role: string;
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

export default function MyCampaignsPage() {
  const {
    data: campaigns,
    isLoading,
    error,
  } = useQuery<MyCampaign[]>({
    queryKey: ['my-campaigns'],
    queryFn: async () => {
      const res = await fetch('/api/me/campaigns');
      if (!res.ok) throw new Error('Failed to fetch campaigns');
      return res.json();
    },
  });

  if (isLoading) {
    return <GenericLoading>Loading your campaigns...</GenericLoading>;
  }

  if (error) {
    return (
      <ResponsiveContainer className="py-8">
        <div className="text-center text-red-500">Failed to load your campaigns. Please try again.</div>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer className="py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="mb-2 text-2xl font-bold">My Campaigns</h1>
        <p className="text-muted-foreground">Campaigns you've joined and are taking action on.</p>
      </div>

      {/* Campaign grid */}
      {campaigns && campaigns.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-muted/30 py-12 text-center">
          <div className="mb-4 text-4xl">📢</div>
          <p className="mb-2 text-lg font-medium">No campaigns yet</p>
          <p className="mb-6 text-muted-foreground">
            Join campaigns that align with your values and start making an impact.
          </p>
          <Link href="/campaigns">
            <Button>Browse Campaigns</Button>
          </Link>
        </div>
      )}
    </ResponsiveContainer>
  );
}
