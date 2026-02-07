'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ResponsiveContainer } from '@/components/ui/ResponsiveContainer';
import { GenericLoading } from '@/components/GenericLoading';
import Button from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { BackArrow, Calendar, Phone, Mail, TwoPeople } from '@/svg_components';
import Link from 'next/link';
import { format, isPast, isToday, isTomorrow } from 'date-fns';
import { cn } from '@/lib/cn';
import { useSessionUserData } from '@/hooks/useSessionUserData';
import { TextInput } from '@/components/ui/TextInput';
import { useEffect, useState } from 'react';

interface ActionDetail {
  id: string;
  title: string;
  description: string | null;
  type: 'EVENT' | 'PHONE' | 'EMAIL' | 'CANVASS';
  dueDate: string;
  isActive: boolean;
  location: string | null;
  eventTime: string | null;
  eventEndTime: string | null;
  locationUrl: string | null;
  callScript: string | null;
  dialerUrl: string | null;
  phoneNumbers: string[];
  emailSubject: string | null;
  emailBody: string | null;
  emailTargets: string[];
  canvassArea: string | null;
  ecanvasserCampaignId: string | null;
  graphics: string[];
  shareText: string | null;
  campaignId: string;
  campaign: {
    id: string;
    name: string;
    description: string;
    status: string;
    cause: { id: string; name: string; icon: string | null; color: string | null };
    org: { id: string; name: string; logoUrl: string | null };
  };
  _count: { participants: number };
  participants?: Array<{ willAttend: boolean; attended: boolean; completedAt: string | null }>;
}

interface RepresentativeInfo {
  name: string;
  office: string;
  party?: string;
  phones: string[];
  urls: string[];
  emails: string[];
  photoUrl?: string;
}

const typeConfig = {
  EVENT: { icon: Calendar, label: 'Event', color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
  PHONE: { icon: Phone, label: 'Phone Bank', color: 'text-sky-500', bgColor: 'bg-sky-500/10' },
  EMAIL: { icon: Mail, label: 'Email', color: 'text-sky-500', bgColor: 'bg-sky-500/10' },
  CANVASS: { icon: TwoPeople, label: 'Canvass', color: 'text-orange-500', bgColor: 'bg-orange-500/10' },
};

export default function ActionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const actionId = params.id as string;
  const [userData] = useSessionUserData();

  const [showRepLookup, setShowRepLookup] = useState(false);
  const [zipCode, setZipCode] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [repInfo, setRepInfo] = useState<RepresentativeInfo[] | null>(null);
  const [repLoading, setRepLoading] = useState(false);
  const [repError, setRepError] = useState<string | null>(null);

  useEffect(() => {
    if (userData?.zipCode && !zipCode) setZipCode(userData.zipCode);
    if (userData?.streetAddress && !streetAddress) setStreetAddress(userData.streetAddress);
  }, [streetAddress, userData?.streetAddress, userData?.zipCode, zipCode]);

  const {
    data: action,
    isLoading,
    error,
  } = useQuery<ActionDetail>({
    queryKey: ['action', actionId],
    queryFn: async () => {
      const res = await fetch(`/api/actions/${actionId}`);
      if (!res.ok) throw new Error('Failed to fetch action');
      return res.json();
    },
  });

  const participateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await fetch(`/api/actions/${actionId}/participate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update participation');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['action', actionId] });
      queryClient.invalidateQueries({ queryKey: ['my-actions'] });
      showToast({ type: 'success', title: 'Participation updated!' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Error', message: err.message });
    },
  });

  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/actions/${actionId}/send-email`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to send email');
      return res.json();
    },
    onSuccess: () => {
      showToast({ type: 'success', title: 'Email sent!' });
    },
    onError: (err: Error) => {
      showToast({ type: 'error', title: 'Error', message: err.message });
    },
  });

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
    } catch (err) {
      setRepError(err instanceof Error ? err.message : 'Failed to fetch representatives');
    } finally {
      setRepLoading(false);
    }
  };

  if (isLoading) {
    return (
      <ResponsiveContainer>
        <GenericLoading />
      </ResponsiveContainer>
    );
  }

  if (error || !action) {
    return (
      <ResponsiveContainer>
        <div className="py-12 text-center">
          <h2 className="mb-2 text-xl font-bold">Action Not Found</h2>
          <p className="mb-4 text-muted-foreground">This action doesn&apos;t exist or has been removed.</p>
          <Button onPress={() => router.push('/my-actions')}>Back to My Actions</Button>
        </div>
      </ResponsiveContainer>
    );
  }

  const config = typeConfig[action.type];
  const Icon = config.icon;
  const dueDate = new Date(action.dueDate);
  const isPastDue = isPast(dueDate) && !isToday(dueDate);
  const userParticipation = action.participants?.[0];
  const hasRSVPd = userParticipation?.willAttend;
  const hasCompleted = userParticipation?.attended;

  const getDateLabel = () => {
    if (isToday(dueDate)) return 'Today';
    if (isTomorrow(dueDate)) return 'Tomorrow';
    return format(dueDate, 'EEEE, MMMM d, yyyy');
  };

  const mailtoUrl = (() => {
    if (!action.emailTargets?.length) return null;
    const targets = action.emailTargets.join(',');
    const p = new URLSearchParams();
    if (action.emailSubject) p.set('subject', action.emailSubject);
    if (action.emailBody) p.set('body', action.emailBody);
    return `mailto:${targets}?${p.toString()}`;
  })();

  const sharePayload = (() => {
    const text = action.shareText?.trim();
    const url = action.graphics?.[0];
    if (!text && !url) return null;
    return { text, url };
  })();

  const handleShare = async () => {
    if (!sharePayload) return;
    if (navigator.share) {
      await navigator.share({ text: sharePayload.text || undefined, url: sharePayload.url || undefined });
      return;
    }
    if (sharePayload.text) {
      await navigator.clipboard.writeText(sharePayload.text);
      showToast({ type: 'success', title: 'Copied to clipboard' });
    }
  };

  return (
    <ResponsiveContainer>
      <div className="space-y-6 py-4">
        {/* Back navigation */}
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <BackArrow className="h-4 w-4" />
          Back
        </button>

        {/* Header */}
        <div className={cn('rounded-lg border border-border bg-card p-6', isPastDue && 'opacity-60')}>
          <div className="mb-4 flex items-center gap-3">
            <div className={cn('flex h-10 w-10 items-center justify-center rounded-full', config.bgColor)}>
              <Icon className={cn('h-5 w-5', config.color)} />
            </div>
            <div>
              <span className="text-xs font-medium uppercase text-muted-foreground">{config.label}</span>
              <h1 className="text-xl font-bold">{action.title}</h1>
            </div>
          </div>

          {/* Date badge */}
          <div className="mb-4 flex items-center gap-3">
            <span
              className={cn(
                'rounded-full px-3 py-1 text-sm font-medium',
                isToday(dueDate)
                  ? 'bg-red-500/10 text-red-500'
                  : isTomorrow(dueDate)
                  ? 'bg-yellow-500/10 text-yellow-500'
                  : 'bg-muted text-muted-foreground',
              )}>
              {getDateLabel()}
            </span>
            {action.eventTime && (
              <span className="text-sm text-muted-foreground">
                at {format(new Date(action.eventTime), 'h:mm a')}
                {action.eventEndTime && ` — ${format(new Date(action.eventEndTime), 'h:mm a')}`}
              </span>
            )}
          </div>

          {/* Participants */}
          <p className="mb-4 text-sm text-muted-foreground">
            {action._count.participants} participant{action._count.participants !== 1 ? 's' : ''}
          </p>

          {/* Status */}
          {hasCompleted && (
            <div className="mb-4 rounded-md bg-sky-500/10 px-4 py-2 text-sm font-medium text-sky-500">
              ✓ You completed this action
            </div>
          )}
          {hasRSVPd && !hasCompleted && (
            <div className="mb-4 rounded-md bg-yellow-500/10 px-4 py-2 text-sm font-medium text-yellow-600">
              You&apos;ve signed up — mark it complete when you&apos;re done!
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2">
            {!hasCompleted && (
              <>
                {!hasRSVPd ? (
                  <Button
                    size="small"
                    onPress={() => participateMutation.mutate({ willAttend: true })}
                    loading={participateMutation.isPending}
                    isDisabled={isPastDue}>
                    {action.type === 'EVENT' ? 'RSVP' : "I'll do this"}
                  </Button>
                ) : (
                  <Button
                    size="small"
                    onPress={() => participateMutation.mutate({ attended: true })}
                    loading={participateMutation.isPending}>
                    Mark Complete
                  </Button>
                )}
              </>
            )}

            {action.type === 'PHONE' && action.dialerUrl && (
              <Button size="small" mode="secondary" onPress={() => window.open(action.dialerUrl!, '_blank')}>
                Open Dialer
              </Button>
            )}

            {action.type === 'EMAIL' && mailtoUrl && (
              <Button size="small" mode="secondary" onPress={() => window.open(mailtoUrl, '_blank')}>
                Compose Email
              </Button>
            )}

            {action.type === 'EMAIL' && action.emailTargets?.length && !hasCompleted && (
              <Button
                size="small"
                mode="secondary"
                loading={sendEmailMutation.isPending}
                onPress={() => sendEmailMutation.mutate()}>
                Send Email
              </Button>
            )}

            {hasCompleted && sharePayload && (
              <Button size="small" mode="secondary" onPress={handleShare}>
                Share
              </Button>
            )}
          </div>
        </div>

        {/* Description */}
        {action.description && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Details</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{action.description}</p>
          </div>
        )}

        {/* Graphics */}
        {action.graphics?.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-lg font-semibold">Media</h2>
            <div className="grid gap-3">
              {action.graphics.map((url, i) => (
                <img
                  key={url}
                  src={url}
                  alt={`${action.title} graphic ${i + 1}`}
                  className="w-full rounded-md object-cover"
                />
              ))}
            </div>
          </div>
        )}

        {/* Location (Event / Canvass) */}
        {(action.type === 'EVENT' || action.type === 'CANVASS') && (action.location || action.canvassArea) && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Location</h2>
            <p className="text-sm text-muted-foreground">📍 {action.location || action.canvassArea}</p>
            {action.locationUrl && (
              <a
                href={action.locationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-sm text-sky-500 hover:underline">
                View on map →
              </a>
            )}
          </div>
        )}

        {/* Call Script (Phone) */}
        {action.type === 'PHONE' && action.callScript && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Call Script</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{action.callScript}</p>
          </div>
        )}

        {/* Phone numbers */}
        {action.type === 'PHONE' && action.phoneNumbers?.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-lg font-semibold">Call Targets</h2>
            <div className="flex flex-wrap gap-2">
              {action.phoneNumbers.map((phone) => (
                <Button key={phone} size="small" mode="secondary" onPress={() => window.open(`tel:${phone}`, '_self')}>
                  {phone}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Find Representative (Phone) */}
        {action.type === 'PHONE' && (
          <div className="rounded-lg border border-border bg-card p-6">
            <button
              type="button"
              onClick={() => setShowRepLookup((prev) => !prev)}
              className="text-lg font-semibold hover:text-sky-500">
              {showRepLookup ? 'Hide Representatives ▲' : 'Find Your Representative ▼'}
            </button>
            {showRepLookup && (
              <div className="mt-4 space-y-3">
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
                      <div
                        key={`${rep.office}-${rep.name}`}
                        className="rounded-md border border-border bg-muted/20 p-4">
                        <p className="font-semibold">{rep.office}</p>
                        <p className="text-sm">{rep.name}</p>
                        {rep.party && <p className="text-xs text-muted-foreground">{rep.party}</p>}
                        <div className="mt-2 flex gap-2">
                          {rep.phones[0] && (
                            <Button
                              size="small"
                              mode="secondary"
                              onPress={() => window.open(`tel:${rep.phones[0]}`, '_self')}>
                              Call {rep.phones[0]}
                            </Button>
                          )}
                          {rep.urls[0] && (
                            <Button size="small" mode="ghost" onPress={() => window.open(rep.urls[0], '_blank')}>
                              Website
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Email body (Email) */}
        {action.type === 'EMAIL' && action.emailBody && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Email Content</h2>
            {action.emailSubject && <p className="mb-2 text-sm font-medium">Subject: {action.emailSubject}</p>}
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{action.emailBody}</p>
          </div>
        )}

        {/* Share section */}
        {hasCompleted && sharePayload && (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Share This Action</h2>
            {sharePayload.text && <p className="mb-3 text-sm text-muted-foreground">{sharePayload.text}</p>}
            <Button size="small" mode="secondary" onPress={handleShare}>
              Share
            </Button>
          </div>
        )}

        {/* Campaign link */}
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="mb-2 text-lg font-semibold">Campaign</h2>
          <Link
            href={`/campaigns/${action.campaign.id}`}
            className="block rounded-md border border-border bg-muted/20 p-4 transition-colors hover:bg-muted/40">
            <p className="font-semibold">{action.campaign.name}</p>
            <p className="text-sm text-muted-foreground">{action.campaign.org.name}</p>
            {action.campaign.cause && (
              <span className="mt-1 inline-block rounded-full bg-sky-500/10 px-2 py-0.5 text-xs text-sky-500">
                {action.campaign.cause.name}
              </span>
            )}
          </Link>
        </div>
      </div>
    </ResponsiveContainer>
  );
}
