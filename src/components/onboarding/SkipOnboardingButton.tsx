'use client';

import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Close } from '@/svg_components';
import { ButtonNaked } from '@/components/ui/ButtonNaked';
import { useToast } from '@/hooks/useToast';

export function SkipOnboardingButton() {
  const router = useRouter();
  const { showToast } = useToast();

  const skipMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/onboarding/skip', {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error('Failed to skip onboarding');
      }
      return res.json();
    },
    onSuccess: () => {
      router.push('/feed');
    },
    onError: (error) => {
      showToast({
        type: 'error',
        title: 'Something went wrong',
        message: error.message,
      });
    },
  });

  return (
    <ButtonNaked
      onPress={() => skipMutation.mutate()}
      className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg bg-background/80 px-3 py-2 text-sm text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground"
      aria-label="Skip setup"
      isDisabled={skipMutation.isPending}>
      <span>Skip for now</span>
      <Close className="h-4 w-4" />
    </ButtonNaked>
  );
}
