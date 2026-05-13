'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useMutation } from '@tanstack/react-query';
import { BuildingBusinessOffice } from '@/svg_components';
import { TextInput } from '@/components/ui/TextInput';
import Button from '@/components/ui/Button';
import { GenericLoading } from '@/components/GenericLoading';
import { useToast } from '@/hooks/useToast';
import { onboardingSchema, OnboardingSchema } from '@/lib/validations/onboarding';
import { CauseSelector } from './CauseSelector';

type Step = 'location' | 'causes' | 'complete';

interface Cause {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  description: string | null;
}

export function OnboardingWizard() {
  const [step, setStep] = useState<Step>('location');
  const router = useRouter();
  const { showToast } = useToast();

  // Fetch causes
  const { data: causes, isLoading: causesLoading } = useQuery<Cause[]>({
    queryKey: ['causes'],
    queryFn: async () => {
      const res = await fetch('/api/causes');
      if (!res.ok) throw new Error('Failed to fetch causes');
      return res.json();
    },
  });

  // Form setup
  const { control, handleSubmit, trigger, watch, setValue } = useForm<OnboardingSchema>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      zipCode: '',
      state: '',
      streetAddress: '',
      causeIds: [],
    },
  });

  const zipCode = watch('zipCode');

  useEffect(() => {
    const zip = (zipCode || '').trim();
    if (!/^\d{5}(-\d{4})?$/.test(zip)) return undefined;

    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(`/api/me/zip-lookup?zip=${encodeURIComponent(zip.slice(0, 5))}`);
        if (!response.ok) return;
        const data = (await response.json()) as { state?: string };
        if (data.state) {
          setValue('state', data.state, { shouldValidate: true, shouldDirty: true });
        }
      } catch {
        // Non-blocking autofill helper.
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [setValue, zipCode]);

  // Submit mutation
  const submitMutation = useMutation({
    mutationFn: async (data: OnboardingSchema) => {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to complete onboarding');
      }
      return res.json();
    },
    onSuccess: () => {
      showToast({
        type: 'success',
        title: 'Welcome to Our Power!',
        message: "Your profile is ready. Let's find campaigns for you.",
      });
      // Redirect immediately
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

  // Handle next step
  const handleNextStep = useCallback(async () => {
    if (step === 'location') {
      const isValid = await trigger(['zipCode', 'state', 'streetAddress']);
      if (isValid) {
        setStep('causes');
      }
    } else if (step === 'causes') {
      handleSubmit((data) => submitMutation.mutate(data))();
    }
  }, [step, trigger, handleSubmit, submitMutation]);

  // Handle back
  const handleBack = useCallback(() => {
    if (step === 'causes') {
      setStep('location');
    }
  }, [step]);

  if (causesLoading) {
    return <GenericLoading>Loading...</GenericLoading>;
  }

  return (
    <div className="mx-auto max-w-lg">
      {/* Progress indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                step === 'location' ? 'bg-primary text-primary-foreground' : 'bg-primary/20 text-primary'
              }`}>
              1
            </div>
            <span className={step === 'location' ? 'font-medium' : 'text-muted-foreground'}>Location</span>
          </div>
          <div className="mx-4 h-px flex-1 bg-border" />
          <div className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                step === 'causes'
                  ? 'bg-primary text-primary-foreground'
                  : step === 'complete'
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}>
              2
            </div>
            <span className={step === 'causes' ? 'font-medium' : 'text-muted-foreground'}>Causes</span>
          </div>
        </div>
      </div>

      {/* Step content */}
      <form onSubmit={(e) => e.preventDefault()}>
        {step === 'location' && (
          <div className="space-y-6">
            <div>
              <h2 className="mb-2 text-2xl font-bold">Where are you located?</h2>
              <p className="text-muted-foreground">This helps us show you relevant local campaigns and actions.</p>
            </div>

            <Controller
              control={control}
              name="zipCode"
              render={({ field: { onChange, ref, value }, fieldState: { error } }) => (
                <TextInput
                  label="Zip Code *"
                  value={value}
                  onChange={onChange}
                  errorMessage={error?.message}
                  ref={ref}
                  placeholder="e.g., 90210"
                />
              )}
            />

            <Controller
              control={control}
              name="streetAddress"
              render={({ field: { onChange, ref, value }, fieldState: { error } }) => (
                <TextInput
                  label="Street Address (optional)"
                  value={value || ''}
                  onChange={(v) => onChange(v || null)}
                  errorMessage={error?.message}
                  ref={ref}
                  Icon={BuildingBusinessOffice}
                  placeholder="For more precise local matching"
                />
              )}
            />

            <Controller
              control={control}
              name="state"
              render={({ field: { onChange, ref, value }, fieldState: { error } }) => (
                <TextInput
                  label="State *"
                  value={value || ''}
                  onChange={(v) => onChange(v.toUpperCase().slice(0, 2))}
                  errorMessage={error?.message}
                  ref={ref}
                  placeholder="e.g., CA"
                />
              )}
            />
          </div>
        )}

        {step === 'causes' && causes && (
          <div className="space-y-6">
            <div>
              <h2 className="mb-2 text-2xl font-bold">What causes matter to you?</h2>
              <p className="text-muted-foreground">We&apos;ll show you campaigns that align with your values.</p>
              <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">What you can do next</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>Join campaigns and RSVP to actions.</li>
                  <li>Send advocacy emails and complete action tasks.</li>
                  <li>Track progress from your dashboard and notifications.</li>
                </ul>
                <Link href="/help" className="mt-2 inline-block text-primary hover:underline">
                  Open help center
                </Link>
              </div>
            </div>

            <Controller
              control={control}
              name="causeIds"
              render={({ field: { onChange, value }, fieldState: { error } }) => (
                <div>
                  <CauseSelector causes={causes} selectedIds={value} onSelectionChange={onChange} minRequired={0} />
                  {error?.message && <p className="mt-2 text-sm text-red-500">{error.message}</p>}
                </div>
              )}
            />
          </div>
        )}

        {step === 'complete' && (
          <div className="py-12 text-center">
            <div className="mb-4 text-6xl">🎉</div>
            <h2 className="mb-2 text-2xl font-bold">You&apos;re all set!</h2>
            <p className="mb-4 text-muted-foreground">Redirecting you to campaigns...</p>
          </div>
        )}

        {/* Navigation buttons */}
        {step !== 'complete' && (
          <div className="mt-8 flex justify-between">
            {step !== 'location' ? (
              <Button mode="secondary" onPress={handleBack}>
                Back
              </Button>
            ) : (
              <div />
            )}
            <Button onPress={handleNextStep} loading={submitMutation.isPending} isDisabled={submitMutation.isPending}>
              {step === 'causes' ? 'Complete Setup' : 'Continue'}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
