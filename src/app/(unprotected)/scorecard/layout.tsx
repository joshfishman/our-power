import type { ReactNode } from 'react';
import { ScorecardNav } from '@/components/scorecard/ScorecardNav';

// Wraps every /scorecard* page with the persistent top nav. Each page keeps
// its own max-width container and content, so the layout only prepends the nav
// and does not otherwise constrain or restyle the page body.
export default function ScorecardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ScorecardNav />
      {children}
    </>
  );
}
