'use client';

import { memo, useMemo } from 'react';
import { cn } from '@/lib/cn';
import Calendar from '@/svg_components/Calendar';
import Phone from '@/svg_components/Phone';
import Mail from '@/svg_components/Mail';
import TwoPeople from '@/svg_components/TwoPeople';
import Button from '@/components/ui/Button';
import { format, isPast, isToday, isTomorrow } from 'date-fns';
import Link from 'next/link';

interface ActionCardProps {
  action: {
    id: string;
    title: string;
    description?: string | null;
    type: 'EVENT' | 'PHONE' | 'EMAIL' | 'CANVASS';
    dueDate: string;
    location?: string | null;
    eventTime?: string | null;
    eventEndTime?: string | null;
    callScript?: string | null;
    emailSubject?: string | null;
    emailBody?: string | null;
    emailTargets?: string[];
    phoneNumbers?: string[];
    targetMode?: 'CIVIC' | 'MANUAL' | 'BOTH' | null;
    targetLevel?: 'LOCAL' | 'STATE' | 'FEDERAL' | null;
    targetOffices?: string[];
    manualTargets?: Array<{ name: string; email?: string | null; phone?: string | null }>;
    canvassArea?: string | null;
    graphics?: string[];
    shareText?: string | null;
    campaign?: {
      id?: string;
      name: string;
      cause?: { icon?: string | null };
    };
    _count?: { participants: number };
    participants?: Array<{ willAttend: boolean; attended: boolean }>;
  };
  onRSVP?: (actionId: string) => void;
  onComplete?: (actionId: string) => void;
  onSendEmail?: (actionId: string) => void;
  onEdit?: (actionId: string) => void;
  canEdit?: boolean;
  isLoading?: boolean;
  isSendingEmail?: boolean;
}

const typeConfig = {
  EVENT: { icon: Calendar, label: 'Event', color: 'text-blue-500' },
  PHONE: { icon: Phone, label: 'Call in Support', color: 'text-sky-500' },
  EMAIL: { icon: Mail, label: 'Email in Support', color: 'text-sky-500' },
  CANVASS: { icon: TwoPeople, label: 'Canvass', color: 'text-orange-500' },
};

export const ActionCard = memo(function ActionCard({
  action,
  onRSVP,
  onComplete,
  onSendEmail,
  onEdit,
  canEdit,
  isLoading,
  isSendingEmail,
}: ActionCardProps) {
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
  const getDueDateTimeLabel = () => {
    const hasSpecificTime = dueDate.getHours() !== 23 || dueDate.getMinutes() !== 59;
    return hasSpecificTime
      ? `${format(dueDate, 'MMM d, yyyy')} at ${format(dueDate, 'h:mm a')}`
      : format(dueDate, 'MMM d, yyyy');
  };

  const manualEmailTargets = useMemo(() => {
    if (action.targetMode !== 'MANUAL' && action.targetMode !== 'BOTH') return [];
    return (action.manualTargets || [])
      .map((target) => target.email?.trim())
      .filter((target): target is string => Boolean(target));
  }, [action.manualTargets, action.targetMode]);

  const resolvedEmailTargets = useMemo(() => {
    if (action.targetMode === 'CIVIC') return [];
    if (action.targetMode === 'MANUAL' || action.targetMode === 'BOTH') return manualEmailTargets;
    return action.emailTargets || [];
  }, [action.emailTargets, action.targetMode, manualEmailTargets]);

  const mailtoUrl = useMemo(() => {
    if (!resolvedEmailTargets.length) return null;
    const targets = resolvedEmailTargets.join(',');
    const params = new URLSearchParams();
    if (action.emailSubject) params.set('subject', action.emailSubject);
    if (action.emailBody) params.set('body', action.emailBody);
    return `mailto:${targets}?${params.toString()}`;
  }, [action.emailBody, action.emailSubject, resolvedEmailTargets]);

  const sharePayload = useMemo(() => {
    const text = action.shareText?.trim();
    const url = action.graphics?.[0];
    if (!text && !url) return null;
    return { text, url };
  }, [action.graphics, action.shareText]);

  const handleShare = async () => {
    if (!sharePayload) return;
    if (navigator.share) {
      await navigator.share({
        text: sharePayload.text || undefined,
        url: sharePayload.url || undefined,
      });
      return;
    }
    if (sharePayload.text) {
      await navigator.clipboard.writeText(sharePayload.text);
    }
  };

  return (
    <article className={cn('rounded-lg border border-border bg-card p-4 transition-colors hover:bg-card/80')}>
      {action.campaign?.name && (
        <p className="mb-2 text-xs text-muted-foreground">
          {action.campaign.cause?.icon ? `${action.campaign.cause.icon} ` : ''}
          {action.campaign.name}
        </p>
      )}
      {(action.location || action.canvassArea) && (
        <p className="mb-2 text-sm text-muted-foreground">📍 {action.location || action.canvassArea}</p>
      )}
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
      <Link href={`/actions/${action.id}`} className="block">
        <h4 className="mb-1 font-medium">{action.title}</h4>
        {action.description && <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">{action.description}</p>}
      </Link>
      {action.graphics?.[0] && (
        <img
          src={action.graphics[0]}
          alt={`${action.title} share graphic`}
          className="mb-3 h-40 w-full rounded-md object-cover"
        />
      )}

      {/* Type-specific info */}
      {action.type === 'EVENT' && action.eventTime && (
        <p className="mb-3 text-sm text-muted-foreground">
          {`at ${format(new Date(action.eventTime), 'h:mm a')}${
            action.eventEndTime ? ` — ${format(new Date(action.eventEndTime), 'h:mm a')}` : ''
          }`}
        </p>
      )}

      {action.type === 'EMAIL' && action.emailSubject && (
        <p className="mb-3 text-sm text-muted-foreground">📧 Subject: {action.emailSubject}</p>
      )}

      {action.type === 'EMAIL' && action.emailBody && (
        <p className="mb-3 whitespace-pre-wrap text-xs text-muted-foreground">{action.emailBody}</p>
      )}

      {/* Participants count */}
      {action._count && (
        <p className="mb-3 text-xs text-muted-foreground">
          {action._count.participants} participant{action._count.participants !== 1 ? 's' : ''}
        </p>
      )}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {action.type === 'EVENT' ? (
          !hasRSVPd && (
            <Button
              size="small"
              mode="subtle"
              onPress={() => onRSVP?.(action.id)}
              loading={isLoading}
              isDisabled={isPastDue}>
              RSVP
            </Button>
          )
        ) : !hasCompleted ? (
          !hasRSVPd ? (
            <Button
              size="small"
              mode="subtle"
              onPress={() => onRSVP?.(action.id)}
              loading={isLoading}
              isDisabled={isPastDue}>
              Commit to this Action
            </Button>
          ) : (
            <Button size="small" onPress={() => onComplete?.(action.id)} loading={isLoading}>
              Mark Complete
            </Button>
          )
        ) : null}

        {hasRSVPd && !hasCompleted && action.type !== 'EVENT' && (
          <span className="text-xs font-medium text-yellow-600">Committed to complete by {getDueDateTimeLabel()}</span>
        )}

        {hasCompleted && <span className="text-sm font-medium text-sky-500">✓ Completed</span>}

        {action.type === 'EMAIL' && mailtoUrl && (
          <Button size="small" mode="secondary" onPress={() => window.open(mailtoUrl, '_blank')}>
            Compose Email
          </Button>
        )}

        {action.type === 'EMAIL' && resolvedEmailTargets.length && !hasCompleted && (
          <Button size="small" mode="secondary" loading={isSendingEmail} onPress={() => onSendEmail?.(action.id)}>
            Send Email
          </Button>
        )}

        {canEdit && (
          <Button size="small" mode="subtle" onPress={() => onEdit?.(action.id)}>
            Edit
          </Button>
        )}
      </div>

      {hasCompleted && sharePayload && (
        <div className="mt-4 rounded-md border border-border bg-muted/20 p-3">
          <p className="mb-2 text-sm font-semibold">Share this action</p>
          {sharePayload.text && <p className="mb-2 text-xs text-muted-foreground">{sharePayload.text}</p>}
          <Button size="small" mode="secondary" onPress={handleShare}>
            Share
          </Button>
        </div>
      )}
    </article>
  );
});

ActionCard.displayName = 'ActionCard';
