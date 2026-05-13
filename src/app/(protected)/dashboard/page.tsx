'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { StatCard, ActionTypeChart } from '@/components/dashboard';
import Bullhorn from '@/svg_components/Bullhorn';
import TwoPeople from '@/svg_components/TwoPeople';
import Calendar from '@/svg_components/Calendar';
import CheckCircle from '@/svg_components/CheckCircle';
import { useState } from 'react';

interface DashboardStats {
  overview: {
    totalCampaigns: number;
    activeCampaigns: number;
    totalMembers: number;
    totalActions: number;
  };
  participation: {
    totalRSVPs: number;
    totalCompleted: number;
    completionRate: number;
  };
  byActionType: Record<string, { actions: number; rsvps: number; completed: number }>;
  timeframe: string;
}

export default function DashboardPage() {
  const [timeframe, setTimeframe] = useState('30d');

  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats', timeframe],
    queryFn: async () => {
      const response = await fetch(`/api/dashboard/stats?timeframe=${timeframe}`);
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="animate-pulse">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-32 rounded-xl bg-muted" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Impact Dashboard</h1>
          <p className="text-muted-foreground">Track your campaign engagement and impact</p>
        </div>

        <div className="flex gap-2">
          {['7d', '30d', '90d', 'all'].map((tf) => (
            <button
              type="button"
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                timeframe === tf ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
              }`}>
              {tf === 'all' ? 'All Time' : tf}
            </button>
          ))}
        </div>
      </div>

      {/* Overview Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Campaigns"
          value={stats?.overview.activeCampaigns || 0}
          subtitle={`${stats?.overview.totalCampaigns || 0} total`}
          icon={<Bullhorn className="h-5 w-5" />}
        />
        <StatCard
          title="Campaign Members"
          value={stats?.overview.totalMembers || 0}
          icon={<TwoPeople className="h-5 w-5" />}
        />
        <StatCard
          title="Total Actions"
          value={stats?.overview.totalActions || 0}
          icon={<Calendar className="h-5 w-5" />}
        />
        <StatCard
          title="Completion Rate"
          value={`${stats?.participation.completionRate || 0}%`}
          subtitle={`${stats?.participation.totalCompleted || 0} completed`}
          icon={<CheckCircle className="h-5 w-5" />}
        />
      </div>

      {/* Action Types Breakdown */}
      {stats?.byActionType && <ActionTypeChart data={stats.byActionType} />}

      {/* Participation Summary */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">Participation Summary</h3>
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total RSVPs</span>
              <span className="text-xl font-bold">{stats?.participation.totalRSVPs || 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Completed Actions</span>
              <span className="text-xl font-bold">{stats?.participation.totalCompleted || 0}</span>
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between">
              <span className="font-medium">Completion Rate</span>
              <span className="text-xl font-bold text-primary">{stats?.participation.completionRate || 0}%</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-lg font-semibold">Quick Actions</h3>
          <p className="text-sm text-muted-foreground">Manage your campaigns and track impact</p>
          <div className="mt-4 grid gap-3">
            <Link
              href="/campaigns"
              className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted">
              <Bullhorn className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">Browse Campaigns</p>
                <p className="text-sm text-muted-foreground">Discover and join new campaigns</p>
              </div>
            </Link>
            <Link
              href="/my-actions"
              className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted">
              <Calendar className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">My Actions</p>
                <p className="text-sm text-muted-foreground">View your upcoming actions</p>
              </div>
            </Link>
            <Link
              href="/help"
              className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted">
              <CheckCircle className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">Help Center</p>
                <p className="text-sm text-muted-foreground">Learn key actions and platform workflows</p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
