'use client';

import { cn } from '@/lib/cn';
import { Calendar, Phone, Mail, TwoPeople } from '@/svg_components';
import Button from '@/components/ui/Button';
import { format, isPast, isToday, isTomorrow } from 'date-fns';

interface ActionCardProps {
  action: {
    id: string;
    title: string;
    description?: string | null;
    type: 'EVENT' | 'PHONE' | 'EMAIL' | 'CANVASS';
    dueDate: string;
    location?: string | null;
    eventTime?: string | null;
    callScript?: string | null;
    emailSubject?: string | null;
    dialerUrl?: string | null;
    _count?: { participants: number };
    participants?: Array<{ willAttend: boolean; attended: boolean }>;
  };
  onRSVP?: (actionId: string) => void;
  onComplete?: (actionId: string) => void;
  isLoading?: boolean;
}

const typeConfig = {
  EVENT: { icon: Calendar, label: 'Event', color: 'text-blue-500' },
  PHONE: { icon: Phone, label: 'Phone Bank', color: 'text-green-500' },
  EMAIL: { icon: Mail, label: 'Email', color: 'text-purple-500' },
  CANVASS: { icon: TwoPeople, label: 'Canvass', color: 'text-orange-500' },
};

export function ActionCard({ action, onRSVP, onComplete, isLoading }: ActionCardProps) {
  const config = typeConfig[action.type];
  const Icon = config.icon;
  const dueDate = new Date(action.dueDate);
  const isPastDue = isPast(dueDate) && !isToday(dueDate);

  // User's participation status
  const userParticipation = action.participants?.[0];
  const hasRSVPd = userParticipation?.willAttend;
  const hasCompleted = userParticipation?.attended;

  const getDateLabel = () => {
    if (isToday(dueDate)) return 'Today';
    if (isTomorrow(dueDate)) return 'Tomorrow';
    return format(dueDate, 'MMM d, yyyy');
  };

  return (
    <article className={cn('rounded-lg border border-border bg-card p-4', isPastDue && 'opacity-60')}>
      {/* Header */}
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-5 w-5', config.color)} />
          <span className="text-xs font-medium uppercase text-muted-foreground">{config.label}</span>
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-1 text-xs font-medium',
            isToday(dueDate)
              ? 'bg-red-500/10 text-red-500'
              : isTomorrow(dueDate)
              ? 'bg-yellow-500/10 text-yellow-500'
              : 'bg-muted text-muted-foreground',
          )}>
          {getDateLabel()}
        </span>
      </div>

      {/* Content */}
      <h4 className="mb-1 font-medium">{action.title}</h4>
      {action.description && <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{action.description}</p>}

      {/* Type-specific info */}
      {action.type === 'EVENT' && action.location && (
        <p className="mb-3 text-sm text-muted-foreground">
          📍 {action.location}
          {action.eventTime && ` at ${format(new Date(action.eventTime), 'h:mm a')}`}
        </p>
      )}

      {/* Participants count */}
      {action._count && (
        <p className="mb-3 text-xs text-muted-foreground">
          {action._count.participants} participant{action._count.participants !== 1 ? 's' : ''}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {!hasCompleted && (
          <>
            {!hasRSVPd ? (
              <Button
                size="small"
                mode="subtle"
                onPress={() => onRSVP?.(action.id)}
                loading={isLoading}
                isDisabled={isPastDue}>
                {action.type === 'EVENT' ? 'RSVP' : "I'll do this"}
              </Button>
            ) : (
              <Button size="small" onPress={() => onComplete?.(action.id)} loading={isLoading}>
                Mark Complete
              </Button>
            )}
          </>
        )}

        {hasCompleted && <span className="text-sm font-medium text-green-500">✓ Completed</span>}

        {action.type === 'PHONE' && action.dialerUrl && (
          <Button size="small" mode="secondary" onPress={() => window.open(action.dialerUrl!, '_blank')}>
            Open Dialer
          </Button>
        )}
      </div>
    </article>
  );
}
