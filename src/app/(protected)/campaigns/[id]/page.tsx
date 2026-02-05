'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ResponsiveContainer } from '@/components/ui/ResponsiveContainer';
import { ActionCard } from '@/components/campaigns';
import { GenericLoading } from '@/components/GenericLoading';
import Button from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { BackArrow, TwoPeople, Calendar, ChartBar } from '@/svg_components';
import Link from 'next/link';
import { useSessionUserData } from '@/hooks/useSessionUserData';

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
    description: string | null;
  };
  actions: Array<{
    id: string;
    title: string;
    description: string | null;
    type: 'EVENT' | 'PHONE' | 'EMAIL' | 'CANVASS';
    dueDate: string;
    location: string | null;
    eventTime: string | null;
    callScript: string | null;
    dialerUrl: string | null;
  }>;
  _count: {
    members: number;
    actions: number;
  };
}

const typeLabels: Record<string, string> = {
  LEGISLATIVE: 'Legislative Campaign',
  FISCAL: 'Fiscal Campaign',
  CRIMINAL_JUSTICE: 'Criminal Justice Campaign',
  ELECTORAL: 'Electoral Campaign',
  COMMUNITY: 'Community Campaign',
  OTHER: 'Campaign',
};

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [userData] = useSessionUserData();

  const campaignId = params.id as string;

  // Fetch campaign details
  const {
    data: campaign,
    isLoading,
    error,
  } = useQuery<Campaign>({
    queryKey: ['campaign', campaignId],
    queryFn: async () => {
      const res = await fetch(`/api/campaigns/${campaignId}`);
      if (!res.ok) throw new Error('Failed to fetch campaign');
      return res.json();
    },
  });

  // Check if user is a member
  const { data: membership } = useQuery({
    queryKey: ['campaign-membership', campaignId, userData?.id],
    queryFn: async () => {
      if (!userData?.id) return null;
      const res = await fetch(`/api/campaigns/${campaignId}/join`);
      // 400 = not a member, which is fine
      if (res.status === 400) return null;
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!userData?.id,
  });

  // Join campaign mutation
  const joinMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/campaigns/${campaignId}/join`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to join');
      }
      return res.json();
    },
    onSuccess: (data) => {
      showToast({ type: 'success', title: data.message });
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaign-membership', campaignId] });
    },
    onError: (err) => {
      showToast({ type: 'error', title: err.message });
    },
  });

  // Leave campaign mutation
  const leaveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/campaigns/${campaignId}/join`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to leave');
      return res.json();
    },
    onSuccess: (data) => {
      showToast({ type: 'success', title: data.message });
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaign-membership', campaignId] });
    },
    onError: (err) => {
      showToast({ type: 'error', title: err.message });
    },
  });

  // RSVP/Complete action mutations
  const participateMutation = useMutation({
    mutationFn: async ({
      actionId,
      data,
    }: {
      actionId: string;
      data: { willAttend?: boolean; attended?: boolean };
    }) => {
      const res = await fetch(`/api/actions/${actionId}/participate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to update participation');
      return res.json();
    },
    onSuccess: (data) => {
      showToast({ type: 'success', title: data.message });
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
    },
    onError: (err) => {
      showToast({ type: 'error', title: err.message });
    },
  });

  const isMember = !!membership;

  if (isLoading) {
    return <GenericLoading>Loading campaign...</GenericLoading>;
  }

  if (error || !campaign) {
    return (
      <ResponsiveContainer className="py-8">
        <div className="text-center">
          <p className="mb-4 text-red-500">Campaign not found</p>
          <Button onPress={() => router.push('/campaigns')}>Back to Campaigns</Button>
        </div>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer className="py-6">
      {/* Back button */}
      <button
        type="button"
        onClick={() => router.push('/campaigns')}
        className="mb-4 flex items-center gap-2 text-muted-foreground hover:text-foreground">
        <BackArrow className="h-4 w-4" />
        Back to Campaigns
      </button>

      {/* Header */}
      <div className="mb-6">
        <div className="mb-2 flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium"
            style={{
              backgroundColor: `${campaign.cause.color}20`,
              color: campaign.cause.color || undefined,
            }}>
            <span>{campaign.cause.icon}</span>
            {campaign.cause.name}
          </span>
          <span className="text-sm text-muted-foreground">{typeLabels[campaign.type]}</span>
        </div>

        <h1 className="mb-2 text-3xl font-bold">{campaign.name}</h1>

        <div className="mb-4 flex items-center gap-4 text-muted-foreground">
          <span className="flex items-center gap-1">
            <TwoPeople className="h-4 w-4" />
            {campaign._count.members} members
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            {campaign._count.actions} actions
          </span>
        </div>

        {/* Organization */}
        <div className="mb-4 flex items-center gap-3 rounded-lg bg-muted/50 p-3">
          {campaign.org.logoUrl ? (
            <img src={campaign.org.logoUrl} alt={campaign.org.name} className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
              {campaign.org.name[0]}
            </div>
          )}
          <div>
            <p className="font-medium">{campaign.org.name}</p>
            {campaign.org.description && (
              <p className="line-clamp-1 text-sm text-muted-foreground">{campaign.org.description}</p>
            )}
          </div>
        </div>

        {/* Join/Leave button and Dashboard link */}
        <div className="flex gap-2">
          {!isMember ? (
            <Button
              onPress={() => joinMutation.mutate()}
              loading={joinMutation.isPending}
              isDisabled={campaign.status !== 'ACTIVE'}>
              Join Campaign
            </Button>
          ) : (
            <Button mode="secondary" onPress={() => leaveMutation.mutate()} loading={leaveMutation.isPending}>
              Leave Campaign
            </Button>
          )}
          {isMember && (
            <Link
              href={`/dashboard/campaign/${campaignId}`}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted">
              <ChartBar className="h-4 w-4" />
              View Dashboard
            </Link>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">About this Campaign</h2>
        <p className="whitespace-pre-wrap text-muted-foreground">{campaign.description}</p>
      </div>

      {/* Actions */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">Upcoming Actions</h2>

        {campaign.actions.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {campaign.actions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                onRSVP={(actionId) => participateMutation.mutate({ actionId, data: { willAttend: true } })}
                onComplete={(actionId) => participateMutation.mutate({ actionId, data: { attended: true } })}
                isLoading={participateMutation.isPending}
              />
            ))}
          </div>
        ) : (
          <p className="py-8 text-center text-muted-foreground">No upcoming actions yet. Check back soon!</p>
        )}
      </div>
    </ResponsiveContainer>
  );
}
