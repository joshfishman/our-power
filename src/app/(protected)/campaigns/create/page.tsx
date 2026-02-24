'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { ResponsiveContainer } from '@/components/ui/ResponsiveContainer';
import { TextInput } from '@/components/ui/TextInput';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { DatePicker } from '@/components/ui/DatePicker';
import Button from '@/components/ui/Button';
import { GenericLoading } from '@/components/GenericLoading';
import { useToast } from '@/hooks/useToast';
import { Item } from 'react-stately';
import { DateValue, today, getLocalTimeZone } from '@internationalized/date';

interface Organization {
  id: string;
  name: string;
}

interface Cause {
  id: string;
  name: string;
  icon: string | null;
}

const campaignTypes = [
  { id: 'LEGISLATIVE', name: 'Legislative' },
  { id: 'FISCAL', name: 'Fiscal' },
  { id: 'CRIMINAL_JUSTICE', name: 'Criminal Justice' },
  { id: 'ELECTORAL', name: 'Electoral' },
  { id: 'COMMUNITY', name: 'Community' },
  { id: 'OTHER', name: 'Other' },
];

const campaignStatuses = [
  { id: 'DRAFT', name: 'Draft' },
  { id: 'ACTIVE', name: 'Active' },
];

export default function CreateCampaignPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const preselectedOrgId = searchParams.get('orgId');
  const { showToast } = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<string>('COMMUNITY');
  const [status, setStatus] = useState<string>('DRAFT');
  const [orgId, setOrgId] = useState<string>(preselectedOrgId || '');
  const [causeId, setCauseId] = useState<string>('');
  const [startDate, setStartDate] = useState<DateValue | null>(null);
  const [endDate, setEndDate] = useState<DateValue | null>(null);

  // Fetch organizations the user manages
  const { data: organizations, isLoading: loadingOrgs } = useQuery<Organization[]>({
    queryKey: ['organizations', 'managed'],
    queryFn: async () => {
      const res = await fetch('/api/organizations?managed=true');
      if (!res.ok) throw new Error('Failed to fetch organizations');
      return res.json();
    },
  });

  // Fetch causes
  const { data: causes, isLoading: loadingCauses } = useQuery<Cause[]>({
    queryKey: ['causes'],
    queryFn: async () => {
      const res = await fetch('/api/causes');
      if (!res.ok) throw new Error('Failed to fetch causes');
      return res.json();
    },
  });

  // Set default orgId when organizations load
  useEffect(() => {
    if (preselectedOrgId) {
      setOrgId(preselectedOrgId);
    } else if (organizations && organizations.length > 0 && !orgId) {
      setOrgId(organizations[0].id);
    }
  }, [organizations, preselectedOrgId, orgId]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          type,
          status,
          orgId,
          causeId,
          startDate: startDate ? `${startDate.toString()}T00:00:00.000Z` : null,
          endDate: endDate ? `${endDate.toString()}T00:00:00.000Z` : null,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create campaign');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['my-campaigns'] });
      showToast({
        type: 'success',
        title: 'Campaign created!',
        message: 'You can now add actions to your campaign.',
      });
      router.push(`/campaigns/${data.id}`);
    },
    onError: (error) => {
      showToast({
        type: 'error',
        title: 'Failed to create campaign',
        message: error.message,
      });
    },
  });

  const isLoading = loadingOrgs || loadingCauses;

  if (isLoading) {
    return <GenericLoading>Loading...</GenericLoading>;
  }

  if (!organizations || organizations.length === 0) {
    return (
      <ResponsiveContainer className="py-6">
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <h1 className="mb-2 text-xl font-bold">No Organizations</h1>
          <p className="mb-4 text-muted-foreground">You need to be a manager of an organization to create campaigns.</p>
          <Button onPress={() => router.push('/organizations')}>Go to Organizations</Button>
        </div>
      </ResponsiveContainer>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !description.trim() || !orgId || !causeId) {
      showToast({
        type: 'error',
        title: 'Missing fields',
        message: 'Please fill in all required fields.',
      });
      return;
    }
    createMutation.mutate();
  };

  return (
    <ResponsiveContainer className="py-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-2xl font-bold">Create Campaign</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Organization Selection */}
          <Select
            label="Organization *"
            name="organization"
            selectedKey={orgId}
            onSelectionChange={(key) => setOrgId(key as string)}>
            {(organizations || []).map((org) => (
              <Item key={org.id}>{org.name}</Item>
            ))}
          </Select>

          {/* Campaign Name */}
          <TextInput label="Campaign Name *" name="name" value={name} onChange={setName} />

          {/* Description */}
          <Textarea label="Description *" name="description" value={description} onChange={setDescription} />

          {/* Cause */}
          <Select
            label="Cause *"
            name="cause"
            selectedKey={causeId}
            onSelectionChange={(key) => setCauseId(key as string)}>
            {(causes || []).map((cause) => (
              <Item key={cause.id} textValue={cause.name}>
                {cause.icon} {cause.name}
              </Item>
            ))}
          </Select>

          {/* Type and Status */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Campaign Type"
              name="type"
              selectedKey={type}
              onSelectionChange={(key) => setType(key as string)}>
              {campaignTypes.map((t) => (
                <Item key={t.id}>{t.name}</Item>
              ))}
            </Select>

            <Select
              label="Status"
              name="status"
              selectedKey={status}
              onSelectionChange={(key) => setStatus(key as string)}>
              {campaignStatuses.map((s) => (
                <Item key={s.id}>{s.name}</Item>
              ))}
            </Select>
          </div>

          {/* Dates */}
          <div className="grid gap-4 sm:grid-cols-2">
            <DatePicker
              label="Start Date (optional)"
              value={startDate}
              onChange={setStartDate}
              minValue={today(getLocalTimeZone())}
            />
            <DatePicker
              label="End Date (optional)"
              value={endDate}
              onChange={setEndDate}
              minValue={startDate || today(getLocalTimeZone())}
            />
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-4">
            <Button type="button" mode="subtle" onPress={() => router.back()}>
              Cancel
            </Button>
            <Button
              type="submit"
              loading={createMutation.isPending}
              isDisabled={!name.trim() || !description.trim() || !orgId || !causeId}>
              Create Campaign
            </Button>
          </div>
        </form>
      </div>
    </ResponsiveContainer>
  );
}
