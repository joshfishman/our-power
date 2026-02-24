'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TextInput } from '@/components/ui/TextInput';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { DatePicker } from '@/components/ui/DatePicker';
import Button from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { Item } from 'react-stately';
import { DateValue, today, getLocalTimeZone, parseDate } from '@internationalized/date';
import Image from 'next/image';
import { cn } from '@/lib/cn';

interface OrgImage {
  name: string;
  url: string;
  createdAt: string;
}

interface CreateActionFormProps {
  campaignId: string;
  orgId?: string;
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
    eventEndTime?: string | null;
    locationUrl?: string | null;
    callScript?: string | null;
    phoneNumbers?: string[];
    emailSubject?: string | null;
    emailBody?: string | null;
    emailTargets?: string[];
    targetMode?: 'CIVIC' | 'MANUAL' | 'BOTH' | null;
    targetLevel?: 'LOCAL' | 'STATE' | 'FEDERAL' | null;
    targetOffices?: string[];
    manualTargets?: Array<{ name: string; email?: string | null; phone?: string | null }>;
    canvassArea?: string | null;
    ecanvasserCampaignId?: string | null;
    graphics?: string[];
    shareText?: string | null;
  };
}

const actionTypes = [
  { id: 'EVENT', name: 'Event', description: 'In-person or virtual event' },
  { id: 'PHONE', name: 'Call in Support', description: 'Call elected representatives' },
  { id: 'EMAIL', name: 'Email in Support', description: 'Send emails to representatives' },
  { id: 'CANVASS', name: 'Canvassing', description: 'Door-to-door outreach' },
];

export function CreateActionForm({
  campaignId,
  orgId,
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
  const [dueDate, setDueDate] = useState<DateValue | null>(defaultDate);
  const [dueTime, setDueTime] = useState(() => {
    const due = initialAction?.dueDate;
    if (!due) return '';
    const isoTime = due.slice(11, 16);
    return isoTime === '23:59' ? '' : isoTime;
  });
  const [eventTime, setEventTime] = useState(initialAction?.eventTime?.slice(11, 16) || '');
  const [eventEndTime, setEventEndTime] = useState(initialAction?.eventEndTime?.slice(11, 16) || '');
  const [useTimeRange, setUseTimeRange] = useState(
    Boolean(initialAction?.eventTime) || Boolean(initialAction?.eventEndTime),
  );
  const [location, setLocation] = useState(initialAction?.location || '');
  const [locationUrl, setLocationUrl] = useState(initialAction?.locationUrl || '');
  const [callScript, setCallScript] = useState(initialAction?.callScript || '');
  const [emailSubject, setEmailSubject] = useState(initialAction?.emailSubject || '');
  const [emailBody, setEmailBody] = useState(initialAction?.emailBody || '');
  const [useCivicTargets, setUseCivicTargets] = useState(() => {
    if (initialAction?.targetMode === 'BOTH') return true;
    if (initialAction?.targetMode === 'CIVIC') return true;
    if (initialAction?.targetMode === 'MANUAL') return false;
    return true;
  });
  const [useManualTargets, setUseManualTargets] = useState(() => {
    if (initialAction?.targetMode === 'BOTH') return true;
    if (initialAction?.targetMode === 'MANUAL') return true;
    if (initialAction?.targetMode === 'CIVIC') return false;
    if (initialAction?.manualTargets?.length) return true;
    if (initialAction?.type === 'EMAIL' && initialAction?.emailTargets?.length) return true;
    if (initialAction?.type === 'PHONE' && initialAction?.phoneNumbers?.length) return true;
    return false;
  });
  const [targetLevel, setTargetLevel] = useState<'LOCAL' | 'STATE' | 'FEDERAL'>(
    initialAction?.targetLevel || 'FEDERAL',
  );
  const [targetOfficesText, setTargetOfficesText] = useState(initialAction?.targetOffices?.join(', ') || '');
  const [manualTargets, setManualTargets] = useState<
    Array<{ name: string; email?: string | null; phone?: string | null }>
  >(() => {
    if (initialAction?.manualTargets?.length) return initialAction.manualTargets;
    if (initialAction?.type === 'EMAIL' && initialAction?.emailTargets?.length) {
      return initialAction.emailTargets.map((email) => ({ name: '', email, phone: '' }));
    }
    if (initialAction?.type === 'PHONE' && initialAction?.phoneNumbers?.length) {
      return initialAction.phoneNumbers.map((phone) => ({ name: '', email: '', phone }));
    }
    return [{ name: '', email: '', phone: '' }];
  });
  const [canvassArea, setCanvassArea] = useState(initialAction?.canvassArea || '');
  const [ecanvasserCampaignId, setEcanvasserCampaignId] = useState(initialAction?.ecanvasserCampaignId || '');
  const [shareText, setShareText] = useState(initialAction?.shareText || '');
  const [imageUrl, setImageUrl] = useState(initialAction?.graphics?.[0] || '');
  const [shareImageFile, setShareImageFile] = useState<File | null>(null);
  const [shareImagePreview, setShareImagePreview] = useState<string | null>(null);
  const [shareImageUploading, setShareImageUploading] = useState(false);
  const [showOrgLibrary, setShowOrgLibrary] = useState(false);
  const shareImageInputRef = useRef<HTMLInputElement>(null);

  // Fetch org's existing images for the library picker
  const { data: orgImages } = useQuery<{ images: OrgImage[] }>({
    queryKey: ['org-images', orgId],
    queryFn: async () => {
      const res = await fetch(`/api/organizations/${orgId}/images`);
      if (!res.ok) return { images: [] };
      return res.json();
    },
    enabled: !!orgId,
  });

  useEffect(() => {
    if (!initialAction) return;
    setTitle(initialAction.title || '');
    setDescription(initialAction.description || '');
    setType(initialAction.type || 'EVENT');
    setDueDate(defaultDate);
    setDueTime(() => {
      const due = initialAction.dueDate;
      const isoTime = due?.slice(11, 16);
      return isoTime === '23:59' ? '' : isoTime || '';
    });
    setEventTime(initialAction.eventTime?.slice(11, 16) || '');
    setEventEndTime(initialAction.eventEndTime?.slice(11, 16) || '');
    setUseTimeRange(Boolean(initialAction.eventTime) || Boolean(initialAction.eventEndTime));
    setLocation(initialAction.location || '');
    setLocationUrl(initialAction.locationUrl || '');
    setCallScript(initialAction.callScript || '');
    setEmailSubject(initialAction.emailSubject || '');
    setEmailBody(initialAction.emailBody || '');
    setUseCivicTargets(initialAction.targetMode === 'BOTH' || initialAction.targetMode === 'CIVIC');
    setUseManualTargets(
      initialAction.targetMode === 'BOTH' ||
        initialAction.targetMode === 'MANUAL' ||
        Boolean(initialAction.manualTargets?.length) ||
        (initialAction.type === 'EMAIL' && Boolean(initialAction.emailTargets?.length)) ||
        (initialAction.type === 'PHONE' && Boolean(initialAction.phoneNumbers?.length)),
    );
    setTargetLevel(initialAction.targetLevel || 'FEDERAL');
    setTargetOfficesText(initialAction.targetOffices?.join(', ') || '');
    setManualTargets(
      initialAction.manualTargets ||
        (initialAction.type === 'EMAIL' && initialAction.emailTargets?.length
          ? initialAction.emailTargets.map((email) => ({ name: '', email, phone: '' }))
          : undefined) ||
        (initialAction.type === 'PHONE' && initialAction.phoneNumbers?.length
          ? initialAction.phoneNumbers.map((phone) => ({ name: '', email: '', phone }))
          : undefined) || [{ name: '', email: '', phone: '' }],
    );
    setCanvassArea(initialAction.canvassArea || '');
    setEcanvasserCampaignId(initialAction.ecanvasserCampaignId || '');
    setShareText(initialAction.shareText || '');
    setImageUrl(initialAction.graphics?.[0] || '');
    setShareImageFile(null);
    setShareImagePreview(null);
  }, [defaultDate, initialAction]);

  const targetOffices = useMemo(() => {
    if (!targetOfficesText.trim()) return [];
    return targetOfficesText
      .split(',')
      .map((office) => office.trim())
      .filter(Boolean);
  }, [targetOfficesText]);

  const isSupportType = type === 'EMAIL' || type === 'PHONE';

  const handleManualTargetChange = (index: number, field: 'name' | 'email' | 'phone', value: string) => {
    setManualTargets((prev) => prev.map((target, i) => (i === index ? { ...target, [field]: value } : target)));
  };

  const addManualTarget = () => {
    setManualTargets((prev) => [...prev, { name: '', email: '', phone: '' }]);
  };

  const removeManualTarget = (index: number) => {
    setManualTargets((prev) => prev.filter((_, i) => i !== index));
  };

  const handleShareImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setShareImageFile(file);
    setShareImagePreview(URL.createObjectURL(file));
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      let uploadedImageUrl = imageUrl;

      if (shareImageFile) {
        setShareImageUploading(true);
        const formData = new FormData();
        formData.append('file', shareImageFile, shareImageFile.name);
        const uploadRes = await fetch(`/api/actions/graphics?campaignId=${campaignId}`, {
          method: 'POST',
          body: formData,
        });
        if (!uploadRes.ok) {
          const error = await uploadRes.json();
          throw new Error(error.error || 'Failed to upload share image');
        }
        const uploaded = await uploadRes.json();
        uploadedImageUrl = uploaded.uploadedTo;
        setImageUrl(uploadedImageUrl);
        setShareImageFile(null);
        setShareImagePreview(null);
      }

      setShareImageUploading(false);

      // Build the ISO datetime for dueDate
      let dueDateISO = null;
      if (dueDate) {
        const dateStr = dueDate.toString();
        if (dueTime) {
          dueDateISO = `${dateStr}T${dueTime}:00.000Z`;
        } else {
          dueDateISO = `${dateStr}T23:59:00.000Z`;
        }
      }

      const cleanedManualTargets = manualTargets
        .map((target) => ({
          name: target.name.trim(),
          email: target.email?.trim() || null,
          phone: target.phone?.trim() || null,
        }))
        .filter((target) => target.name);

      const civicEnabled = isSupportType && useCivicTargets;
      const manualEnabled = isSupportType && useManualTargets;
      const computedTargetMode = !isSupportType
        ? null
        : civicEnabled && manualEnabled
        ? 'BOTH'
        : civicEnabled
        ? 'CIVIC'
        : manualEnabled
        ? 'MANUAL'
        : null;

      const payload = {
        title,
        description: description || null,
        type,
        dueDate: dueDateISO,
        ...(isEditing ? {} : { campaignId }),
        // EVENT fields
        location: type === 'EVENT' ? location || null : null,
        eventTime: useTimeRange && eventTime ? `${dueDate?.toString()}T${eventTime}:00.000Z` : null,
        eventEndTime: useTimeRange && eventEndTime ? `${dueDate?.toString()}T${eventEndTime}:00.000Z` : null,
        locationUrl: type === 'EVENT' ? locationUrl || null : null,
        // PHONE fields
        callScript: type === 'PHONE' ? callScript || null : null,
        // EMAIL fields
        emailSubject: type === 'EMAIL' ? emailSubject || null : null,
        emailBody: type === 'EMAIL' ? emailBody || null : null,
        emailTargets: type === 'EMAIL' ? [] : [],
        targetMode: computedTargetMode,
        targetLevel: civicEnabled ? targetLevel : null,
        targetOffices: civicEnabled ? targetOffices : [],
        manualTargets: manualEnabled ? cleanedManualTargets : [],
        // CANVASS fields
        canvassArea: type === 'CANVASS' ? canvassArea || null : null,
        ecanvasserCampaignId: type === 'CANVASS' ? ecanvasserCampaignId || null : null,
        graphics: uploadedImageUrl ? [uploadedImageUrl] : [],
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
      setShareImageUploading(false);
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
      <TextInput label="Title *" name="title" value={title} onChange={setTitle} />

      {/* Description */}
      <Textarea label="Description" name="description" value={description} onChange={setDescription} />

      {/* Due Date */}
      <DatePicker label="Date *" value={dueDate} onChange={setDueDate} minValue={today(getLocalTimeZone())} />
      <TextInput label="Due Time (optional)" name="dueTime" type="time" value={dueTime} onChange={setDueTime} />
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={useTimeRange}
          onChange={(event) => {
            const { checked } = event.target;
            setUseTimeRange(checked);
            if (!checked) {
              setEventTime('');
              setEventEndTime('');
            }
          }}
        />
        Set begin and end time window
      </label>
      {useTimeRange && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput label="Begin Time" name="eventTime" type="time" value={eventTime} onChange={setEventTime} />
          <TextInput label="End Time" name="eventEndTime" type="time" value={eventEndTime} onChange={setEventEndTime} />
        </div>
      )}

      {/* EVENT-specific fields */}
      {type === 'EVENT' && (
        <>
          <TextInput label="Location" name="location" value={location} onChange={setLocation} />
          <TextInput
            label="Location URL (optional)"
            name="locationUrl"
            type="url"
            value={locationUrl}
            onChange={setLocationUrl}
          />
        </>
      )}

      {/* PHONE-specific fields */}
      {type === 'PHONE' && (
        <Textarea label="Call Script" name="callScript" value={callScript} onChange={setCallScript} />
      )}

      {/* EMAIL-specific fields */}
      {type === 'EMAIL' && (
        <>
          <TextInput label="Email Subject" name="emailSubject" value={emailSubject} onChange={setEmailSubject} />
          <Textarea label="Email Body" name="emailBody" value={emailBody} onChange={setEmailBody} />
        </>
      )}

      {isSupportType && (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <h4 className="mb-2 text-sm font-semibold">Support Targeting</h4>
          <div className="space-y-2">
            <p className="text-sm font-medium">Targeting Options</p>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={useCivicTargets}
                onChange={(event) => setUseCivicTargets(event.target.checked)}
              />
              Representative lookup (Civic API)
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={useManualTargets}
                onChange={(event) => setUseManualTargets(event.target.checked)}
              />
              Manual targets
            </label>
            {!useCivicTargets && !useManualTargets && (
              <p className="text-xs text-muted-foreground">Select at least one targeting option.</p>
            )}
          </div>

          {useCivicTargets && (
            <div className="mt-3 space-y-3">
              <Select
                label="Target Level"
                name="targetLevel"
                selectedKey={targetLevel}
                onSelectionChange={(key) => setTargetLevel(key as 'LOCAL' | 'STATE' | 'FEDERAL')}>
                <Item key="LOCAL">Local</Item>
                <Item key="STATE">State</Item>
                <Item key="FEDERAL">Federal</Item>
              </Select>
              <TextInput
                label="Specific Offices (optional, comma-separated)"
                name="targetOffices"
                value={targetOfficesText}
                onChange={setTargetOfficesText}
                placeholder="e.g., City Council, Mayor"
              />
            </div>
          )}

          {useManualTargets && (
            <div className="mt-3 space-y-3">
              {manualTargets.map((target, index) => (
                <div key={`${target.name}-${index}`} className="grid gap-3 sm:grid-cols-3">
                  <TextInput
                    label="Name"
                    name={`manualTargetName-${index}`}
                    value={target.name}
                    onChange={(value) => handleManualTargetChange(index, 'name', value)}
                  />
                  {type === 'EMAIL' ? (
                    <TextInput
                      label="Email"
                      name={`manualTargetEmail-${index}`}
                      type="email"
                      value={target.email || ''}
                      onChange={(value) => handleManualTargetChange(index, 'email', value)}
                    />
                  ) : (
                    <TextInput
                      label="Phone"
                      name={`manualTargetPhone-${index}`}
                      value={target.phone || ''}
                      onChange={(value) => handleManualTargetChange(index, 'phone', value)}
                    />
                  )}
                  <div className="flex items-end">
                    <Button type="button" size="small" mode="subtle" onPress={() => removeManualTarget(index)}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              <Button type="button" size="small" mode="subtle" onPress={addManualTarget}>
                Add Target
              </Button>
            </div>
          )}
        </div>
      )}

      {/* CANVASS-specific fields */}
      {type === 'CANVASS' && (
        <>
          <TextInput label="Canvass Area" name="canvassArea" value={canvassArea} onChange={setCanvassArea} />
          <TextInput
            label="Ecanvasser Campaign ID (optional)"
            name="ecanvasserCampaignId"
            value={ecanvasserCampaignId}
            onChange={setEcanvasserCampaignId}
          />
        </>
      )}

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <h4 className="mb-2 text-sm font-semibold">Share Prompt (optional)</h4>

        {/* Image selection */}
        <div className="mb-3">
          <p className="mb-1 text-sm font-medium text-muted-foreground">Share Image</p>
          <div className="flex items-center gap-4">
            {shareImagePreview || imageUrl ? (
              <div className="relative">
                <img
                  src={shareImagePreview || imageUrl}
                  alt="Share graphic"
                  className="h-20 w-20 rounded-lg object-cover"
                />
                <button
                  type="button"
                  className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-xs text-white"
                  onClick={() => {
                    setImageUrl('');
                    setShareImageFile(null);
                    setShareImagePreview(null);
                  }}>
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-lg bg-muted text-2xl text-muted-foreground">
                📣
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Button type="button" size="small" mode="subtle" onPress={() => shareImageInputRef.current?.click()}>
                {shareImagePreview || imageUrl ? 'Change Image' : 'Upload New'}
              </Button>
              {orgImages?.images && orgImages.images.length > 0 && (
                <Button type="button" size="small" mode="ghost" onPress={() => setShowOrgLibrary(!showOrgLibrary)}>
                  {showOrgLibrary ? 'Hide Existing' : 'Show Existing'}
                </Button>
              )}
              <input
                id="share-image-upload"
                ref={shareImageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleShareImageChange}
                className="hidden"
              />
            </div>
          </div>
        </div>

        {/* Org image library */}
        {showOrgLibrary && orgImages?.images && orgImages.images.length > 0 && (
          <div className="mb-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Select from org library:</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {orgImages.images.map((img) => (
                <button
                  type="button"
                  key={img.url}
                  className={cn(
                    'relative aspect-square overflow-hidden rounded-lg border-2 transition-all hover:opacity-80',
                    imageUrl === img.url ? 'border-primary ring-2 ring-primary/30' : 'border-transparent',
                  )}
                  onClick={() => {
                    setImageUrl(img.url);
                    setShareImageFile(null);
                    setShareImagePreview(null);
                    setShowOrgLibrary(false);
                  }}>
                  <Image src={img.url} alt={img.name} fill className="object-cover" sizes="80px" />
                </button>
              ))}
            </div>
          </div>
        )}
        {showOrgLibrary && orgImages?.images && orgImages.images.length === 0 && (
          <p className="mb-3 text-xs text-muted-foreground">
            No images found. Upload images to your organization or campaign graphics to build your library.
          </p>
        )}

        <Textarea label="Suggested Share Text" name="shareText" value={shareText} onChange={setShareText} />
      </div>

      {/* Submit */}
      <div className="flex gap-3 pt-2">
        {onCancel && (
          <Button type="button" mode="subtle" onPress={onCancel}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          loading={createMutation.isPending || shareImageUploading}
          isDisabled={!title.trim() || !dueDate}>
          {isEditing ? 'Update Action' : 'Create Action'}
        </Button>
      </div>
    </form>
  );
}
