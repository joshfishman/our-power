'use client';

import { useEffect } from 'react';
import { logError } from '@/lib/logger';
import { useRouter } from 'next/navigation';

export default function ProtectedError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    logError('Protected route error', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="mb-2 text-2xl font-bold text-foreground">Something went wrong</h2>
      <p className="mb-6 max-w-md text-muted-foreground">
        We encountered an error loading this page. Please try again or go back to your feed.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-accent">
          Try again
        </button>
        <button
          type="button"
          onClick={() => router.push('/feed')}
          className="rounded-lg border border-border bg-card px-6 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
          Go to Feed
        </button>
      </div>
    </div>
  );
}
