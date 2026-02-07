'use client';

import { useSession } from 'next-auth/react';
import React, { useRef } from 'react';
import { compressImage } from '@/lib/compressImage';
import { useDialogs } from './useDialogs';
import { useToast } from './useToast';
import { useSessionUserDataMutation } from './mutations/useSessionUserDataMutation';

export function useUpdateProfileAndCoverPhotoClient(toUpdate: 'profile' | 'cover') {
  const { data: session } = useSession();
  const userId = session?.user.id;
  const { updateSessionUserPhotosMutation } = useSessionUserDataMutation();
  const { alert } = useDialogs();
  const { showToast } = useToast();
  const inputFileRef = useRef<HTMLInputElement>(null);

  const openInput = () => {
    if (inputFileRef.current == null) return;
    inputFileRef.current.click();
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, files } = e.target;

    if (files === null) return;
    const originalFile = files[0];

    // Compress the image before uploading to stay within Vercel's 4.5MB body limit
    let file: File;
    try {
      file = await compressImage(originalFile, {
        maxWidth: toUpdate === 'profile' ? 1024 : 2048,
        maxHeight: toUpdate === 'profile' ? 1024 : 1024,
        quality: 0.85,
      });
    } catch {
      file = originalFile;
    }

    const formData = new FormData();
    formData.append(name, file, file.name);

    if (!userId) return;
    updateSessionUserPhotosMutation.mutate(
      {
        toUpdate,
        formData,
      },
      {
        onSuccess: () => {
          showToast({
            title: 'Success!',
            message: `Your ${toUpdate} photo has been updated.`,
            type: 'success',
          });
        },
        onError: () => {
          alert({
            title: 'Upload Error',
            message: 'There was an error uploading your photo. Please try a smaller image (under 4MB).',
          });
        },
      },
    );

    if (inputFileRef.current === null) return;
    inputFileRef.current.value = '';
  };

  return {
    inputFileRef,
    openInput,
    handleChange,
    isPending: updateSessionUserPhotosMutation.isPending,
  };
}
