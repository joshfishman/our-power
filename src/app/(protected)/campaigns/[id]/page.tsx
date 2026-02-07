'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ResponsiveContainer } from '@/components/ui/ResponsiveContainer';
import { ActionCard, CreateActionForm } from '@/components/campaigns';
import { GenericLoading } from '@/components/GenericLoading';
import Button from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { BackArrow, TwoPeople, Calendar, ChartBar, ActionsPlus } from '@/svg_components';
import Link from 'next/link';
import Image from 'next/image';
import { useSessionUserData } from '@/hooks/useSessionUserData';
import { TextInput } from '@/components/ui/TextInput';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { DatePicker } from '@/components/ui/DatePicker';
import { Item } from 'react-stately';
import { today, getLocalTimeZone, parseDate, type DateValue } from '@internationalized/date';

interface Campaign {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  imageUrl?: string | null;
  startDate?: string | null;
  endDate?: string | null;
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
    emailSubject: string | null;
    emailBody: string | null;
    emailTargets: string[];
    canvassArea: string | null;
    graphics?: string[];
    shareText?: string | null;
    _count: { participants: number };
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
  const [showCreateAction, setShowCreateAction] = useState(false);
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [showEditCampaign, setShowEditCampaign] = useState(false);
  const [hasReviewedActions, setHasReviewedActions] = useState(false);

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

  const { data: causes } = useQuery<Array<{ id: string; name: string; icon: string | null }>>({
    queryKey: ['causes'],
    queryFn: async () => {
      const res = await fetch('/api/causes');
      if (!res.ok) throw new Error('Failed to fetch causes');
      return res.json();
    },
  });

  // Check if user is a member
  const { data: membership } = useQuery({
    queryKey: ['campaign-membership', campaignId, userData?.id],
    queryFn: async () => {
      if (!userData?.id) return null;
      const res = await fetch(`/api/campaigns/${campaignId}/join`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.isMember ? data : null;
    },
    enabled: !!userData?.id,
  });

  // Check if user is an org manager (can create actions)
  const { data: managedOrgs } = useQuery<Array<{ id: string }>>({
    queryKey: ['organizations', 'managed'],
    queryFn: async () => {
      const res = await fetch('/api/organizations?managed=true');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!userData?.id,
  });

  const isOrgManager = campaign && managedOrgs?.some((org) => org.id === campaign.org.id);
  const editingAction = useMemo(
    () => campaign?.actions.find((action) => action.id === editingActionId) || null,
    [campaign?.actions, editingActionId],
  );
  const editStartDate = campaign?.startDate ? parseDate(campaign.startDate.split('T')[0]) : null;
  const editEndDate = campaign?.endDate ? parseDate(campaign.endDate.split('T')[0]) : null;
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editType, setEditType] = useState<string>('COMMUNITY');
  const [editStatus, setEditStatus] = useState<string>('DRAFT');
  const [editCauseId, setEditCauseId] = useState<string>('');
  const [editStart, setEditStart] = useState<DateValue | null>(null);
  const [editEnd, setEditEnd] = useState<DateValue | null>(null);
  const triggerRef = useCallback(() => {}, []);

  useEffect(() => {
    if (!campaign) return;
    setEditName(campaign.name);
    setEditDescription(campaign.description);
    setEditType(campaign.type);
    setEditStatus(campaign.status);
    setEditCauseId(campaign.cause.id);
    setEditStart(editStartDate);
    setEditEnd(editEndDate);
  }, [campaign, editEndDate, editStartDate]);

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

  // Send email action mutation
  const sendEmailMutation = useMutation({
    mutationFn: async (actionId: string) => {
      const res = await fetch(`/api/actions/${actionId}/send-email`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to send email');
      }
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
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update participation');
      }
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

  const updateCampaignMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to update campaign');
      }
      return res.json();
    },
    onSuccess: () => {
      showToast({ type: 'success', title: 'Campaign updated' });
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
    },
    onError: (err) => {
      showToast({ type: 'error', title: err.message });
    },
  });

  const publishCampaign = () => {
    updateCampaignMutation.mutate({ status: 'ACTIVE' });
  };

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
          <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
            {campaign.status}
          </span>
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
            <Image
              src={campaign.org.logoUrl}
              alt={campaign.org.name}
              width={40}
              height={40}
              className="h-10 w-10 rounded-full object-cover"
            />
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
        {isOrgManager && (
          <div className="mt-3 flex gap-2">
            <Button size="small" mode="subtle" onPress={() => setShowEditCampaign((prev) => !prev)}>
              {showEditCampaign ? 'Cancel Edit' : 'Edit Campaign'}
            </Button>
          </div>
        )}
      </div>

      {isOrgManager && showEditCampaign && (
        <div className="mb-8 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold">Edit Campaign</h2>
          <div className="space-y-4">
            <TextInput label="Campaign Name" name="editName" value={editName} onChange={setEditName} />
            <Textarea
              label="Description"
              name="editDescription"
              value={editDescription}
              onChange={setEditDescription}
            />
            <Select
              label="Cause"
              name="cause"
              selectedKey={editCauseId}
              onSelectionChange={(key) => setEditCauseId(key as string)}>
              {(causes || []).map((cause) => (
                <Item key={cause.id}>
                  {cause.icon} {cause.name}
                </Item>
              ))}
            </Select>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Type"
                name="type"
                selectedKey={editType}
                onSelectionChange={(key) => setEditType(key as string)}>
                {Object.entries(typeLabels).map(([key, label]) => (
                  <Item key={key}>{label}</Item>
                ))}
              </Select>
              <Select
                label="Status"
                name="status"
                selectedKey={editStatus}
                onSelectionChange={(key) => setEditStatus(key as string)}>
                {['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED'].map((status) => (
                  <Item key={status}>{status}</Item>
                ))}
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <DatePicker
                label="Start Date (optional)"
                value={editStart}
                onChange={(value) => setEditStart(value)}
                minValue={today(getLocalTimeZone())}
                triggerRef={triggerRef}
              />
              <DatePicker
                label="End Date (optional)"
                value={editEnd}
                onChange={(value) => setEditEnd(value)}
                minValue={editStart ?? today(getLocalTimeZone())}
                triggerRef={triggerRef}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onPress={() =>
                  updateCampaignMutation.mutate({
                    name: editName,
                    description: editDescription,
                    type: editType,
                    status: editStatus,
                    causeId: editCauseId,
                    startDate: editStart ? `${editStart.toString()}T00:00:00.000Z` : null,
                    endDate: editEnd ? `${editEnd.toString()}T00:00:00.000Z` : null,
                  })
                }
                loading={updateCampaignMutation.isPending}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Description */}
      <div className="mb-8">
        <h2 className="mb-2 text-lg font-semibold">About this Campaign</h2>
        <p className="whitespace-pre-wrap text-muted-foreground">{campaign.description}</p>
      </div>

      {isOrgManager && campaign.status === 'DRAFT' && (
        <div className="mb-8 rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 text-lg font-semibold">Review & Publish</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Review the actions below before publishing. Members can only join active campaigns.
          </p>
          <label className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={hasReviewedActions}
              onChange={(e) => setHasReviewedActions(e.target.checked)}
            />
            I have reviewed the campaign details and actions.
          </label>
          <Button
            onPress={publishCampaign}
            isDisabled={!hasReviewedActions || campaign.actions.length === 0}
            loading={updateCampaignMutation.isPending}>
            Publish Campaign
          </Button>
          {campaign.actions.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Add at least one action before publishing.</p>
          )}
        </div>
      )}

      {/* Actions */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Upcoming Actions</h2>
          {isOrgManager && (
            <Button size="small" Icon={ActionsPlus} onPress={() => setShowCreateAction(!showCreateAction)}>
              {showCreateAction ? 'Cancel' : 'Add Action'}
            </Button>
          )}
        </div>

        {/* Create Action Form */}
        {showCreateAction && isOrgManager && (
          <div className="mb-6 rounded-xl border border-border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Create New Action</h3>
            <CreateActionForm
              campaignId={campaignId}
              onSuccess={() => setShowCreateAction(false)}
              onCancel={() => setShowCreateAction(false)}
            />
          </div>
        )}

        {editingAction && isOrgManager && (
          <div className="mb-6 rounded-xl border border-border bg-card p-6">
            <h3 className="mb-4 text-lg font-semibold">Edit Action</h3>
            <CreateActionForm
              campaignId={campaignId}
              mode="edit"
              actionId={editingAction.id}
              initialAction={editingAction}
              onSuccess={() => setEditingActionId(null)}
              onCancel={() => setEditingActionId(null)}
            />
          </div>
        )}

        {campaign.actions.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {campaign.actions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                onRSVP={(actionId) => participateMutation.mutate({ actionId, data: { willAttend: true } })}
                onComplete={(actionId) => participateMutation.mutate({ actionId, data: { attended: true } })}
                onSendEmail={(actionId) => sendEmailMutation.mutate(actionId)}
                isLoading={participateMutation.isPending}
                isSendingEmail={sendEmailMutation.isPending}
                canEdit={isOrgManager}
                onEdit={(actionId) => {
                  setShowCreateAction(false);
                  setEditingActionId(actionId);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border py-8 text-center">
            <p className="text-muted-foreground">No upcoming actions yet.</p>
            {isOrgManager && !showCreateAction && (
              <Button className="mt-4" mode="subtle" Icon={ActionsPlus} onPress={() => setShowCreateAction(true)}>
                Create First Action
              </Button>
            )}
          </div>
        )}
      </div>
    </ResponsiveContainer>
  );
}
