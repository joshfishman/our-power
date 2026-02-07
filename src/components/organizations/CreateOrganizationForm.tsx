'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TextInput } from '@/components/ui/TextInput';
import { Textarea } from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';

interface CreateOrganizationFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function CreateOrganizationForm({ onSuccess, onCancel }: CreateOrganizationFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || null,
          website: website || null,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create organization');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      showToast({
        type: 'success',
        title: 'Organization created!',
        message: 'You can now create campaigns for this organization.',
      });
      setName('');
      setDescription('');
      setWebsite('');
      onSuccess?.();
    },
    onError: (error) => {
      showToast({
        type: 'error',
        title: 'Failed to create organization',
        message: error.message,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TextInput
        label="Organization Name"
        name="name"
        value={name}
        onChange={setName}
        placeholder="e.g., Climate Action Coalition"
        required
      />

      <Textarea
        label="Description"
        name="description"
        value={description}
        onChange={setDescription}
        placeholder="What does this organization do?"
        rows={3}
      />

      <TextInput
        label="Website (optional)"
        name="website"
        type="url"
        value={website}
        onChange={setWebsite}
        placeholder="https://example.org"
      />

      <div className="flex gap-3 pt-2">
        {onCancel && (
          <Button type="button" mode="subtle" onPress={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" loading={createMutation.isPending} isDisabled={!name.trim()}>
          Create Organization
        </Button>
      </div>
    </form>
  );
}
