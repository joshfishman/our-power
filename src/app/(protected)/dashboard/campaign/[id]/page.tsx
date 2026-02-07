'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { StatCard, MemberGrowthChart, TopParticipants } from '@/components/dashboard';
import { TwoPeople, Calendar, CheckCircle, ArrowLeft } from '@/svg_components';
import Link from 'next/link';

interface CampaignDashboard {
  campaign: {
    id: string;
    name: string;
    description: string;
    type: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    organization: { id: string; name: string };
    cause: { id: string; name: string };
  };
  isOrganizer: boolean;
  stats: {
    totalMembers: number;
    totalActions: number;
    activeActions: number;
    totalRSVPs: number;
    totalCompleted: number;
  };
  actionStats: Array<{
    id: string;
    title: string;
    type: string;
    dueDate: string;
    isActive: boolean;
    totalRSVPs: number;
    totalCompleted: number;
    canvassStats?: {
      doorsKnocked: number;
      contactsMade: number;
      supporters: number;
    } | null;
  }>;
  memberGrowth: Record<string, number>;
  topParticipants: Array<{
    userId: string;
    name: string;
    profilePhoto?: string | null;
    completedActions: number;
  }>;
}

const ACTION_TYPE_LABELS: Record<string, string> = {
  EVENT: 'Event',
  PHONE: 'Phone Banking',
  EMAIL: 'Email Action',
  CANVASS: 'Canvassing',
};

export default function CampaignDashboardPage() {
  const params = useParams();
  const campaignId = params.id as string;

  const { data, isLoading, error } = useQuery<CampaignDashboard>({
    queryKey: ['campaign-dashboard', campaignId],
    queryFn: async () => {
      const response = await fetch(`/api/dashboard/campaign/${campaignId}`);
      if (!response.ok) throw new Error('Failed to fetch campaign dashboard');
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="animate-pulse">
          <div className="h-8 w-64 rounded bg-muted" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 rounded-xl bg-muted" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
          <p className="text-destructive">Failed to load campaign dashboard</p>
          <Link href="/campaigns" className="mt-4 inline-block text-sm text-primary hover:underline">
            Back to campaigns
          </Link>
        </div>
      </div>
    );
  }

  const completionRate =
    data.stats.totalRSVPs > 0 ? Math.round((data.stats.totalCompleted / data.stats.totalRSVPs) * 100) : 0;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <Link
          href={`/campaigns/${campaignId}`}
          className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to campaign
        </Link>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">{data.campaign.name}</h1>
            <p className="text-muted-foreground">
              {data.campaign.organization.name} • {data.campaign.cause.name}
            </p>
          </div>

          {data.isOrganizer && (
            <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
              Organizer View
            </span>
          )}
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Members" value={data.stats.totalMembers} icon={<TwoPeople className="h-5 w-5" />} />
        <StatCard
          title="Active Actions"
          value={data.stats.activeActions}
          subtitle={`${data.stats.totalActions} total`}
          icon={<Calendar className="h-5 w-5" />}
        />
        <StatCard title="Total RSVPs" value={data.stats.totalRSVPs} />
        <StatCard
          title="Completion Rate"
          value={`${completionRate}%`}
          subtitle={`${data.stats.totalCompleted} completed`}
          icon={<CheckCircle className="h-5 w-5" />}
        />
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        <MemberGrowthChart data={data.memberGrowth} />
        <TopParticipants participants={data.topParticipants} />
      </div>

      {/* Action Stats Table */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h3 className="text-lg font-semibold">Action Performance</h3>
        <p className="text-sm text-muted-foreground">Detailed breakdown of each action</p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-sm text-muted-foreground">
                <th className="pb-3 font-medium">Action</th>
                <th className="pb-3 font-medium">Type</th>
                <th className="pb-3 font-medium">Due Date</th>
                <th className="pb-3 text-right font-medium">RSVPs</th>
                <th className="pb-3 text-right font-medium">Completed</th>
                <th className="pb-3 text-right font-medium">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.actionStats.map((action) => {
                const rate = action.totalRSVPs > 0 ? Math.round((action.totalCompleted / action.totalRSVPs) * 100) : 0;

                return (
                  <tr key={action.id} className="text-sm">
                    <td className="py-3">
                      <div>
                        <p className="font-medium">{action.title}</p>
                        {!action.isActive && <span className="text-xs text-muted-foreground">(Inactive)</span>}
                      </div>
                    </td>
                    <td className="py-3">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {ACTION_TYPE_LABELS[action.type] || action.type}
                      </span>
                    </td>
                    <td className="py-3 text-muted-foreground">{new Date(action.dueDate).toLocaleDateString()}</td>
                    <td className="py-3 text-right font-medium">{action.totalRSVPs}</td>
                    <td className="py-3 text-right font-medium">{action.totalCompleted}</td>
                    <td className="py-3 text-right">
                      <span
                        className={`font-medium ${
                          rate >= 70 ? 'text-sky-600' : rate >= 40 ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                        {rate}%
                      </span>
                    </td>
                  </tr>
                );
              })}

              {data.actionStats.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    No actions yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Canvass Stats (if any) */}
      {data.actionStats.some((a) => a.canvassStats) && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">Canvassing Impact</h3>
          <p className="text-sm text-muted-foreground">Results from Ecanvasser integration</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {data.actionStats
              .filter((a) => a.canvassStats)
              .map((action) => (
                <div key={action.id} className="rounded-lg border border-border p-4">
                  <p className="font-medium">{action.title}</p>
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Doors Knocked</span>
                      <span className="font-medium">{action.canvassStats?.doorsKnocked || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Contacts Made</span>
                      <span className="font-medium">{action.canvassStats?.contactsMade || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Supporters</span>
                      <span className="font-medium text-sky-600">{action.canvassStats?.supporters || 0}</span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
