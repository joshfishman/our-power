'use client';

import { cn } from '@/lib/cn';
import { useMemo } from 'react';

interface MemberGrowthChartProps {
  data: Record<string, number>;
  className?: string;
}

export function MemberGrowthChart({ data, className }: MemberGrowthChartProps) {
  const chartData = useMemo(() => {
    // Generate last 30 days
    const days: { date: string; count: number; label: string }[] = [];
    const now = new Date();

    for (let i = 29; i >= 0; i -= 1) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      days.push({
        date: dateStr,
        count: data[dateStr] || 0,
        label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      });
    }

    return days;
  }, [data]);

  const maxCount = Math.max(...chartData.map((d) => d.count), 1);
  const totalGrowth = chartData.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className={cn('rounded-xl border border-border bg-card p-6', className)}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold">Member Growth</h3>
          <p className="text-sm text-muted-foreground">Last 30 days</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">+{totalGrowth}</p>
          <p className="text-sm text-muted-foreground">new members</p>
        </div>
      </div>

      <div className="mt-6 flex h-32 items-end gap-1">
        {chartData.map((day) => (
          <div key={day.date} className="group relative flex-1">
            <div
              className="w-full rounded-t bg-primary transition-all hover:bg-primary/80"
              style={{ height: `${(day.count / maxCount) * 100}%`, minHeight: day.count > 0 ? '4px' : '0' }}
            />
            {/* Tooltip */}
            <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 opacity-0 transition-opacity group-hover:opacity-100">
              <div className="rounded bg-popover px-2 py-1 text-xs shadow-lg">
                <p className="font-medium">{day.label}</p>
                <p className="text-muted-foreground">{day.count} members</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{chartData[0]?.label}</span>
        <span>{chartData[chartData.length - 1]?.label}</span>
      </div>
    </div>
  );
}
