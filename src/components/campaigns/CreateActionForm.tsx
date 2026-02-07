'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TextInput } from '@/components/ui/TextInput';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { DatePicker } from '@/components/ui/DatePicker';
import Button from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { Item } from 'react-stately';
import { today, getLocalTimeZone, parseDate } from '@internationalized/date';

interface CreateActionFormProps {
  campaignId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  mode?: 'create' | 'edit';
  actionId?: string;
  initialAction?: {
    title: string;
    description?: string | null;
    type: 'EVENT' | 'PHONE' | 'EMAIL' | 'CANVASS';
    dueDate: string;
    location?: string | null;
    eventTime?: string | null;
    locationUrl?: string | null;
    callScript?: string | null;
    dialerUrl?: string | null;
    emailSubject?: string | null;
    emailBody?: string | null;
    emailTargets?: string[];
    canvassArea?: string | null;
    ecanvasserCampaignId?: string | null;
    graphics?: string[];
    shareText?: string | null;
  };
}

const actionTypes = [
  { id: 'EVENT', name: 'Event', description: 'In-person or virtual event' },
  { id: 'PHONE', name: 'Phone Banking', description: 'Make calls to contacts' },
  { id: 'EMAIL', name: 'Email Campaign', description: 'Send emails to targets' },
  { id: 'CANVASS', name: 'Canvassing', description: 'Door-to-door outreach' },
];

export function CreateActionForm({
  campaignId,
  onSuccess,
  onCancel,
  mode = 'create',
  actionId,
  initialAction,
}: CreateActionFormProps) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const isEditing = mode === 'edit';

  const defaultDate = useMemo(() => {
    if (!initialAction?.dueDate) return null;
    return parseDate(initialAction.dueDate.split('T')[0]);
  }, [initialAction?.dueDate]);

  const [title, setTitle] = useState(initialAction?.title || '');
  const [description, setDescription] = useState(initialAction?.description || '');
  const [type, setType] = useState<string>(initialAction?.type || 'EVENT');
  const [dueDate, setDueDate] = useState<ReturnType<typeof today> | null>(defaultDate);
  const [eventTime, setEventTime] = useState(initialAction?.eventTime?.slice(11, 16) || '');
  const [location, setLocation] = useState(initialAction?.location || '');
  const [locationUrl, setLocationUrl] = useState(initialAction?.locationUrl || '');
  const [callScript, setCallScript] = useState(initialAction?.callScript || '');
  const [dialerUrl, setDialerUrl] = useState(initialAction?.dialerUrl || '');
  const [emailSubject, setEmailSubject] = useState(initialAction?.emailSubject || '');
  const [emailBody, setEmailBody] = useState(initialAction?.emailBody || '');
  const [emailTargetsText, setEmailTargetsText] = useState(initialAction?.emailTargets?.join(', ') || '');
  const [canvassArea, setCanvassArea] = useState(initialAction?.canvassArea || '');
  const [ecanvasserCampaignId, setEcanvasserCampaignId] = useState(initialAction?.ecanvasserCampaignId || '');
  const [shareText, setShareText] = useState(initialAction?.shareText || '');
  const [imageUrl, setImageUrl] = useState(initialAction?.graphics?.[0] || '');

  useEffect(() => {
    if (!initialAction) return;
    setTitle(initialAction.title || '');
    setDescription(initialAction.description || '');
    setType(initialAction.type || 'EVENT');
    setDueDate(defaultDate);
    setEventTime(initialAction.eventTime?.slice(11, 16) || '');
    setLocation(initialAction.location || '');
    setLocationUrl(initialAction.locationUrl || '');
    setCallScript(initialAction.callScript || '');
    setDialerUrl(initialAction.dialerUrl || '');
    setEmailSubject(initialAction.emailSubject || '');
    setEmailBody(initialAction.emailBody || '');
    setEmailTargetsText(initialAction.emailTargets?.join(', ') || '');
    setCanvassArea(initialAction.canvassArea || '');
    setEcanvasserCampaignId(initialAction.ecanvasserCampaignId || '');
    setShareText(initialAction.shareText || '');
    setImageUrl(initialAction.graphics?.[0] || '');
  }, [defaultDate, initialAction]);

  const emailTargets = useMemo(() => {
    if (!emailTargetsText.trim()) return [];
    return emailTargetsText
      .split(',')
      .map((target) => target.trim())
      .filter(Boolean);
  }, [emailTargetsText]);

  const createMutation = useMutation({
    mutationFn: async () => {
      // Build the ISO datetime for dueDate
      let dueDateISO = null;
      if (dueDate) {
        const dateStr = dueDate.toString();
        if (eventTime && type === 'EVENT') {
          dueDateISO = `${dateStr}T${eventTime}:00.000Z`;
        } else {
          dueDateISO = `${dateStr}T23:59:00.000Z`;
        }
      }

      const payload = {
        title,
        description: description || null,
        type,
        dueDate: dueDateISO,
        ...(isEditing ? {} : { campaignId }),
        // EVENT fields
        location: type === 'EVENT' ? location || null : null,
        eventTime: type === 'EVENT' && eventTime ? `${dueDate?.toString()}T${eventTime}:00.000Z` : null,
        locationUrl: type === 'EVENT' ? locationUrl || null : null,
        // PHONE fields
        callScript: type === 'PHONE' ? callScript || null : null,
        dialerUrl: type === 'PHONE' ? dialerUrl || null : null,
        // EMAIL fields
        emailSubject: type === 'EMAIL' ? emailSubject || null : null,
        emailBody: type === 'EMAIL' ? emailBody || null : null,
        emailTargets: type === 'EMAIL' ? emailTargets : [],
        // CANVASS fields
        canvassArea: type === 'CANVASS' ? canvassArea || null : null,
        ecanvasserCampaignId: type === 'CANVASS' ? ecanvasserCampaignId || null : null,
        graphics: imageUrl ? [imageUrl] : [],
        shareText: shareText || null,
      };

      const url = isEditing ? `/api/actions/${actionId}` : '/api/actions';
      const method = isEditing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || `Failed to ${isEditing ? 'update' : 'create'} action`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      showToast({
        type: 'success',
        title: isEditing ? 'Action updated!' : 'Action created!',
        message: isEditing ? 'Your changes are live.' : 'Members will be notified about this action.',
      });
      onSuccess?.();
    },
    onError: (error) => {
      showToast({
        type: 'error',
        title: isEditing ? 'Failed to update action' : 'Failed to create action',
        message: error.message,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !dueDate) {
      showToast({
        type: 'error',
        title: 'Missing fields',
        message: 'Please fill in title and date.',
      });
      return;
    }
    if (isEditing && !actionId) {
      showToast({
        type: 'error',
        title: 'Missing action id',
        message: 'Unable to update this action right now.',
      });
      return;
    }
    createMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Action Type */}
      <Select label="Action Type" name="type" selectedKey={type} onSelectionChange={(key) => setType(key as string)}>
        {actionTypes.map((t) => (
          <Item key={t.id}>{t.name}</Item>
        ))}
      </Select>

      {/* Title */}
      <TextInput
        label="Title *"
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g., Call Your Representative"
        required
      />

      {/* Description */}
      <Textarea
        label="Description"
        name="description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What should participants do?"
        rows={3}
      />

      {/* Due Date */}
      <DatePicker label="Date *" value={dueDate} onChange={setDueDate} minValue={today(getLocalTimeZone())} />

      {/* EVENT-specific fields */}
      {type === 'EVENT' && (
        <>
          <TextInput
            label="Time (optional)"
            name="eventTime"
            type="time"
            value={eventTime}
            onChange={(e) => setEventTime(e.target.value)}
          />
          <TextInput
            label="Location"
            name="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g., City Hall, 123 Main St"
          />
          <TextInput
            label="Location URL (optional)"
            name="locationUrl"
            type="url"
            value={locationUrl}
            onChange={(e) => setLocationUrl(e.target.value)}
            placeholder="https://maps.google.com/..."
          />
        </>
      )}

      {/* PHONE-specific fields */}
      {type === 'PHONE' && (
        <>
          <Textarea
            label="Call Script"
            name="callScript"
            value={callScript}
            onChange={(e) => setCallScript(e.target.value)}
            placeholder="What should callers say?"
            rows={4}
          />
          <TextInput
            label="Dialer URL (Scale to Win / GetThru)"
            name="dialerUrl"
            type="url"
            value={dialerUrl}
            onChange={(e) => setDialerUrl(e.target.value)}
            placeholder="https://app.scaletowin.com/..."
          />
        </>
      )}

      {/* EMAIL-specific fields */}
      {type === 'EMAIL' && (
        <>
          <TextInput
            label="Email Subject"
            name="emailSubject"
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            placeholder="Subject line for the email"
          />
          <Textarea
            label="Email Body"
            name="emailBody"
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            placeholder="The email content participants should send"
            rows={5}
          />
          <TextInput
            label="Email Targets (comma-separated)"
            name="emailTargets"
            value={emailTargetsText}
            onChange={(e) => setEmailTargetsText(e.target.value)}
            placeholder="rep@example.gov, staff@example.gov"
          />
        </>
      )}

      {/* CANVASS-specific fields */}
      {type === 'CANVASS' && (
        <>
          <TextInput
            label="Canvass Area"
            name="canvassArea"
            value={canvassArea}
            onChange={(e) => setCanvassArea(e.target.value)}
            placeholder="e.g., Downtown District, Precinct 5"
          />
          <TextInput
            label="Ecanvasser Campaign ID (optional)"
            name="ecanvasserCampaignId"
            value={ecanvasserCampaignId}
            onChange={(e) => setEcanvasserCampaignId(e.target.value)}
            placeholder="For Ecanvasser integration"
          />
        </>
      )}

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <h4 className="mb-2 text-sm font-semibold">Share Prompt (optional)</h4>
        <TextInput
          label="Share Image URL"
          name="shareImageUrl"
          type="url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://..."
        />
        <Textarea
          label="Suggested Share Text"
          name="shareText"
          value={shareText}
          onChange={(e) => setShareText(e.target.value)}
          placeholder="Copy for sharing after completion"
          rows={3}
        />
      </div>

      {/* Submit */}
      <div className="flex gap-3 pt-2">
        {onCancel && (
          <Button type="button" mode="subtle" onPress={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={createMutation.isPending} isDisabled={!title.trim() || !dueDate}>
          {isEditing ? 'Update Action' : 'Create Action'}
        </Button>
      </div>
    </form>
  );
}
