'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TextInput } from '@/components/ui/TextInput';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { DatePicker } from '@/components/ui/DatePicker';
import Button from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { Item } from 'react-stately';
import { today, getLocalTimeZone } from '@internationalized/date';

interface CreateActionFormProps {
  campaignId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const actionTypes = [
  { id: 'EVENT', name: 'Event', description: 'In-person or virtual event' },
  { id: 'PHONE', name: 'Phone Banking', description: 'Make calls to contacts' },
  { id: 'EMAIL', name: 'Email Campaign', description: 'Send emails to targets' },
  { id: 'CANVASS', name: 'Canvassing', description: 'Door-to-door outreach' },
];

export function CreateActionForm({ campaignId, onSuccess, onCancel }: CreateActionFormProps) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<string>('EVENT');
  const [dueDate, setDueDate] = useState<ReturnType<typeof today> | null>(null);
  const [eventTime, setEventTime] = useState('');
  const [location, setLocation] = useState('');
  const [locationUrl, setLocationUrl] = useState('');
  const [callScript, setCallScript] = useState('');
  const [dialerUrl, setDialerUrl] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [canvassArea, setCanvassArea] = useState('');
  const [ecanvasserCampaignId, setEcanvasserCampaignId] = useState('');

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

      const res = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description || null,
          type,
          dueDate: dueDateISO,
          campaignId,
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
          // CANVASS fields
          canvassArea: type === 'CANVASS' ? canvassArea || null : null,
          ecanvasserCampaignId: type === 'CANVASS' ? ecanvasserCampaignId || null : null,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create action');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      showToast({
        type: 'success',
        title: 'Action created!',
        message: 'Members will be notified about this action.',
      });
      onSuccess?.();
    },
    onError: (error) => {
      showToast({
        type: 'error',
        title: 'Failed to create action',
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

      {/* Submit */}
      <div className="flex gap-3 pt-2">
        {onCancel && (
          <Button type="button" mode="subtle" onPress={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={createMutation.isPending} isDisabled={!title.trim() || !dueDate}>
          Create Action
        </Button>
      </div>
    </form>
  );
}
