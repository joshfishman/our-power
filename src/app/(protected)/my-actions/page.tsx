'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ResponsiveContainer } from '@/components/ui/ResponsiveContainer';
import { ActionCard } from '@/components/campaigns';
import { GenericLoading } from '@/components/GenericLoading';
import Button from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { isToday, isTomorrow, isThisWeek } from 'date-fns';

interface MyAction {
  id: string;
  title: string;
  description: string | null;
  type: 'EVENT' | 'PHONE' | 'EMAIL' | 'CANVASS';
  dueDate: string;
  location: string | null;
  eventTime: string | null;
  callScript: string | null;
  emailSubject?: string | null;
  emailBody?: string | null;
  emailTargets?: string[];
  phoneNumbers?: string[];
  campaign: {
    id: string;
    name: string;
    cause: { name: string; icon: string | null; color: string | null };
  };
  _count: { participants: number };
  participants: Array<{ willAttend: boolean; attended: boolean; completedAt: string | null }>;
  graphics?: string[];
  shareText?: string | null;
}

export default function MyActionsPage() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const {
    data: actions,
    isLoading,
    error,
  } = useQuery<MyAction[]>({
    queryKey: ['my-actions'],
    queryFn: async () => {
      const res = await fetch('/api/me/actions?committed=true&completed=true');
      if (!res.ok) throw new Error('Failed to fetch actions');
      return res.json();
    },
  });

  const participateMutation = useMutation({
    mutationFn: async ({ actionId, data }: { actionId: string; data: Record<string, unknown> }) => {
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
      queryClient.invalidateQueries({ queryKey: ['my-actions'] });
    },
    onError: (error) => {
      showToast({ type: 'error', title: error.message });
    },
  });

  if (isLoading) {
    return <GenericLoading>Loading your actions...</GenericLoading>;
  }

  if (error) {
    return (
      <ResponsiveContainer className="py-8">
        <div className="text-center text-red-500">Failed to load your actions. Please try again.</div>
      </ResponsiveContainer>
    );
  }

  // Group actions by timeframe
  const groupedActions = {
    today: actions?.filter((a) => isToday(new Date(a.dueDate))) || [],
    tomorrow: actions?.filter((a) => isTomorrow(new Date(a.dueDate))) || [],
    thisWeek:
      actions?.filter((a) => {
        const date = new Date(a.dueDate);
        return isThisWeek(date) && !isToday(date) && !isTomorrow(date);
      }) || [],
    later:
      actions?.filter((a) => {
        const date = new Date(a.dueDate);
        return !isThisWeek(date);
      }) || [],
  };

  const hasActions = actions && actions.length > 0;

  return (
    <ResponsiveContainer className="py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="mb-2 text-2xl font-bold">My Actions</h1>
        <p className="text-muted-foreground">Actions you&apos;ve committed to. Follow through and make a difference!</p>
      </div>

      {hasActions ? (
        <div className="space-y-8">
          {/* Today */}
          {groupedActions.today.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-red-500">🔥 Today</h2>
              <div className="grid gap-4">
                {groupedActions.today.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    onRSVP={(actionId) => participateMutation.mutate({ actionId, data: { willAttend: true } })}
                    onComplete={(actionId) => participateMutation.mutate({ actionId, data: { attended: true } })}
                    isLoading={participateMutation.isPending}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Tomorrow */}
          {groupedActions.tomorrow.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-yellow-500">⏰ Tomorrow</h2>
              <div className="grid gap-4">
                {groupedActions.tomorrow.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    onRSVP={(actionId) => participateMutation.mutate({ actionId, data: { willAttend: true } })}
                    onComplete={(actionId) => participateMutation.mutate({ actionId, data: { attended: true } })}
                    isLoading={participateMutation.isPending}
                  />
                ))}
              </div>
            </section>
          )}

          {/* This Week */}
          {groupedActions.thisWeek.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">📅 This Week</h2>
              <div className="grid gap-4">
                {groupedActions.thisWeek.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    onRSVP={(actionId) => participateMutation.mutate({ actionId, data: { willAttend: true } })}
                    onComplete={(actionId) => participateMutation.mutate({ actionId, data: { attended: true } })}
                    isLoading={participateMutation.isPending}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Later */}
          {groupedActions.later.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-muted-foreground">🗓️ Later</h2>
              <div className="grid gap-4">
                {groupedActions.later.map((action) => (
                  <ActionCard
                    key={action.id}
                    action={action}
                    onRSVP={(actionId) => participateMutation.mutate({ actionId, data: { willAttend: true } })}
                    onComplete={(actionId) => participateMutation.mutate({ actionId, data: { attended: true } })}
                    isLoading={participateMutation.isPending}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-muted/30 py-12 text-center">
          <div className="mb-4 text-4xl">✊</div>
          <p className="mb-2 text-lg font-medium">No committed actions</p>
          <p className="mb-6 text-muted-foreground">RSVP or commit to an action to track it here.</p>
          <Link href="/campaigns">
            <Button>Browse Campaigns</Button>
          </Link>
        </div>
      )}
    </ResponsiveContainer>
  );
}
