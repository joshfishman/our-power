'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Unhandled error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="mb-2 text-2xl font-bold text-foreground">Something went wrong</h2>
      <p className="mb-6 max-w-md text-muted-foreground">
        An unexpected error occurred. Please try again, or contact support if the problem persists.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-accent">
        Try again
      </button>
    </div>
  );
}
