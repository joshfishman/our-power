'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { Calendar, Phone, Mail, TwoPeople } from '@/svg_components';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { format, isPast, isToday, isTomorrow } from 'date-fns';
import { useSessionUserData } from '@/hooks/useSessionUserData';

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
    emailBody?: string | null;
    emailTargets?: string[];
    dialerUrl?: string | null;
    phoneNumbers?: string[];
    canvassArea?: string | null;
    graphics?: string[];
    shareText?: string | null;
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
  PHONE: { icon: Phone, label: 'Phone Bank', color: 'text-sky-500' },
  EMAIL: { icon: Mail, label: 'Email', color: 'text-sky-500' },
  CANVASS: { icon: TwoPeople, label: 'Canvass', color: 'text-orange-500' },
};

interface RepresentativeInfo {
  name: string;
  office: string;
  party?: string;
  phones: string[];
  urls: string[];
  emails: string[];
  photoUrl?: string;
}

export function ActionCard({
  action,
  onRSVP,
  onComplete,
  onSendEmail,
  onEdit,
  canEdit,
  isLoading,
  isSendingEmail,
}: ActionCardProps) {
  const [userData] = useSessionUserData();
  const [showRepLookup, setShowRepLookup] = useState(false);
  const [zipCode, setZipCode] = useState(userData?.zipCode || '');
  const [streetAddress, setStreetAddress] = useState(userData?.streetAddress || '');
  const [repInfo, setRepInfo] = useState<RepresentativeInfo[] | null>(null);
  const [repLoading, setRepLoading] = useState(false);
  const [repError, setRepError] = useState<string | null>(null);

  useEffect(() => {
    if (userData?.zipCode && !zipCode) {
      setZipCode(userData.zipCode);
    }
    if (userData?.streetAddress && !streetAddress) {
      setStreetAddress(userData.streetAddress);
    }
  }, [streetAddress, userData?.streetAddress, userData?.zipCode, zipCode]);

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

  const mailtoUrl = useMemo(() => {
    if (!action.emailTargets?.length) return null;
    const targets = action.emailTargets.join(',');
    const params = new URLSearchParams();
    if (action.emailSubject) params.set('subject', action.emailSubject);
    if (action.emailBody) params.set('body', action.emailBody);
    return `mailto:${targets}?${params.toString()}`;
  }, [action.emailBody, action.emailSubject, action.emailTargets]);

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

  const fetchRepresentatives = async () => {
    setRepError(null);
    setRepLoading(true);
    try {
      if (!zipCode.trim()) {
        setRepError('Add your zip code to find your representative.');
        return;
      }

      const locationRes = await fetch('/api/me/location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipCode: zipCode.trim(), streetAddress: streetAddress.trim() || null }),
      });
      if (!locationRes.ok) {
        const errorData = await locationRes.json();
        throw new Error(errorData.error || 'Failed to save your location');
      }

      const address = [streetAddress, zipCode].filter(Boolean).join(', ');
      const res = await fetch(`/api/civic/representatives?address=${encodeURIComponent(address)}`);
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to fetch representatives');
      }
      const data = await res.json();
      setRepInfo(data.officials || []);
    } catch (error) {
      setRepError(error instanceof Error ? error.message : 'Failed to fetch representatives');
    } finally {
      setRepLoading(false);
    }
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
      {action.graphics?.[0] && (
        <img
          src={action.graphics[0]}
          alt={`${action.title} share graphic`}
          className="mb-3 h-40 w-full rounded-md object-cover"
        />
      )}

      {/* Type-specific info */}
      {action.type === 'EVENT' && action.location && (
        <p className="mb-3 text-sm text-muted-foreground">
          📍 {action.location}
          {action.eventTime && ` at ${format(new Date(action.eventTime), 'h:mm a')}`}
        </p>
      )}

      {action.type === 'CANVASS' && action.canvassArea && (
        <p className="mb-3 text-sm text-muted-foreground">📍 {action.canvassArea}</p>
      )}

      {action.type === 'EMAIL' && action.emailSubject && (
        <p className="mb-3 text-sm text-muted-foreground">📧 Subject: {action.emailSubject}</p>
      )}

      {action.type === 'EMAIL' && action.emailBody && (
        <p className="mb-3 whitespace-pre-wrap text-xs text-muted-foreground">{action.emailBody}</p>
      )}

      {action.type === 'PHONE' && action.callScript && (
        <div className="mb-3 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="mb-1 text-sm font-semibold text-foreground">Call Script</p>
          <p className="whitespace-pre-wrap">{action.callScript}</p>
        </div>
      )}

      {action.type === 'PHONE' && action.phoneNumbers?.length ? (
        <div className="mb-3 text-xs text-muted-foreground">
          <p className="mb-1 text-sm font-semibold text-foreground">Call Targets</p>
          <div className="flex flex-wrap gap-2">
            {action.phoneNumbers.map((phone) => (
              <Button key={phone} size="small" mode="ghost" onPress={() => window.open(`tel:${phone}`, '_self')}>
                {phone}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

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

        {hasCompleted && <span className="text-sm font-medium text-sky-500">✓ Completed</span>}

        {action.type === 'PHONE' && action.dialerUrl && (
          <Button size="small" mode="secondary" onPress={() => window.open(action.dialerUrl!, '_blank')}>
            Open Dialer
          </Button>
        )}

        {action.type === 'PHONE' && (
          <Button size="small" mode="secondary" onPress={() => setShowRepLookup((prev) => !prev)}>
            {showRepLookup ? 'Hide Representatives' : 'Find Representative'}
          </Button>
        )}

        {action.type === 'EMAIL' && mailtoUrl && (
          <Button size="small" mode="secondary" onPress={() => window.open(mailtoUrl, '_blank')}>
            Compose Email
          </Button>
        )}

        {action.type === 'EMAIL' && action.emailTargets?.length && !hasCompleted && (
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

      {action.type === 'PHONE' && showRepLookup && (
        <div className="mt-4 space-y-3 rounded-lg border border-border bg-muted/20 p-3">
          <TextInput
            label="Street Address (optional)"
            name="streetAddress"
            value={streetAddress}
            onChange={(e) => setStreetAddress(e.target.value)}
            placeholder="123 Main St"
          />
          <TextInput
            label="Zip Code *"
            name="zipCode"
            value={zipCode}
            onChange={(e) => setZipCode(e.target.value)}
            placeholder="90001"
          />
          <Button size="small" onPress={fetchRepresentatives} loading={repLoading}>
            Find Representatives
          </Button>
          {repError && <p className="text-sm text-red-500">{repError}</p>}
          {repInfo && repInfo.length > 0 && (
            <div className="space-y-3">
              {repInfo.map((rep) => (
                <div key={`${rep.office}-${rep.name}`} className="rounded-md border border-border bg-card p-3">
                  <p className="text-sm font-semibold">{rep.office}</p>
                  <p className="text-sm">{rep.name}</p>
                  {rep.party && <p className="text-xs text-muted-foreground">{rep.party}</p>}
                  {rep.phones[0] && (
                    <Button size="small" mode="secondary" onPress={() => window.open(`tel:${rep.phones[0]}`, '_self')}>
                      Call {rep.phones[0]}
                    </Button>
                  )}
                  {rep.urls[0] && (
                    <Button size="small" mode="ghost" onPress={() => window.open(rep.urls[0], '_blank')}>
                      Website
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
}
