import type { ReactNode } from 'react';

// The top nav now lives in the (unprotected) shell, shared with every other
// surface, so this layout only passes its children through. Each scorecard
// page keeps its own max-width container.
export default function ScorecardLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
