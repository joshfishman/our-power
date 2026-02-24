'use client';

import React, { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TextInput } from '@/components/ui/TextInput';
import { Textarea } from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import { useToast } from '@/hooks/useToast';
import { compressImage } from '@/lib/compressImage';
import Image from 'next/image';

interface CreateOrganizationFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function CreateOrganizationForm({ onSuccess, onCancel }: CreateOrganizationFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file, { maxWidth: 512, maxHeight: 512, quality: 0.85 });
      setLogoFile(compressed);
      setLogoPreview(URL.createObjectURL(compressed));
    } catch {
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      // 1. Create the org
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
      const org = await res.json();

      // 2. Upload logo if provided
      if (logoFile) {
        const formData = new FormData();
        formData.append('file', logoFile, logoFile.name);
        await fetch(`/api/organizations/${org.id}/photo?type=logo`, {
          method: 'POST',
          body: formData,
        });
      }

      return org;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      queryClient.invalidateQueries({ queryKey: ['organizations', 'managed'] });
      showToast({
        type: 'success',
        title: 'Organization created!',
        message: 'You can now create campaigns for this organization.',
      });
      setName('');
      setDescription('');
      setWebsite('');
      setLogoFile(null);
      setLogoPreview(null);
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
      {/* Logo upload */}
      <div>
        <label htmlFor="org-logo-upload" className="mb-1 block text-sm font-medium">
          Logo (optional)
        </label>
        <div className="flex items-center gap-4">
          {logoPreview ? (
            <Image
              src={logoPreview}
              alt="Logo preview"
              width={64}
              height={64}
              className="h-16 w-16 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-2xl text-muted-foreground">
              🏛️
            </div>
          )}
          <div>
            <Button type="button" size="small" mode="subtle" onPress={() => logoInputRef.current?.click()}>
              {logoPreview ? 'Change Logo' : 'Upload Logo'}
            </Button>
            <input
              id="org-logo-upload"
              ref={logoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleLogoChange}
              className="hidden"
            />
          </div>
        </div>
      </div>

      <TextInput
        label="Organization Name"
        name="name"
        value={name}
        onChange={setName}
        placeholder="e.g., Climate Action Coalition"
        isRequired
      />

      <Textarea
        label="Description"
        name="description"
        value={description}
        onChange={setDescription}
        placeholder="What does this organization do?"
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
