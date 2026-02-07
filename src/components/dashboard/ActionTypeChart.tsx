'use client';

import { cn } from '@/lib/cn';

interface ActionTypeData {
  actions: number;
  rsvps: number;
  completed: number;
}

interface ActionTypeChartProps {
  data: Record<string, ActionTypeData>;
  className?: string;
}

const ACTION_TYPE_COLORS: Record<string, { bg: string; bar: string; label: string }> = {
  EVENT: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    bar: 'bg-blue-500',
    label: 'Events',
  },
  PHONE: {
    bg: 'bg-sky-100 dark:bg-sky-900/30',
    bar: 'bg-sky-500',
    label: 'Phone Banking',
  },
  EMAIL: {
    bg: 'bg-sky-100 dark:bg-sky-900/30',
    bar: 'bg-sky-500',
    label: 'Email Actions',
  },
  CANVASS: {
    bg: 'bg-orange-100 dark:bg-orange-900/30',
    bar: 'bg-orange-500',
    label: 'Canvassing',
  },
};

export function ActionTypeChart({ data, className }: ActionTypeChartProps) {
  const maxCompleted = Math.max(...Object.values(data).map((d) => d.completed), 1);

  return (
    <div className={cn('rounded-xl border border-border bg-card p-6', className)}>
      <h3 className="text-lg font-semibold">Actions by Type</h3>
      <div className="mt-6 space-y-4">
        {Object.entries(data).map(([type, stats]) => {
          const config = ACTION_TYPE_COLORS[type];
          if (!config) return null;

          const completionRate = stats.rsvps > 0 ? Math.round((stats.completed / stats.rsvps) * 100) : 0;

          return (
            <div key={type} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{config.label}</span>
                <span className="text-muted-foreground">
                  {stats.completed} completed / {stats.rsvps} RSVPs
                </span>
              </div>
              <div className={cn('h-3 rounded-full', config.bg)}>
                <div
                  className={cn('h-full rounded-full transition-all', config.bar)}
                  style={{ width: `${(stats.completed / maxCompleted) * 100}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{stats.actions} actions</span>
                <span>{completionRate}% completion rate</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
