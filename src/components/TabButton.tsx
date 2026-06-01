import { cn } from '@/lib/cn';
// Replaced `from 'lodash'` import; see src/lib/utils/native.ts (chore/deps-and-bundle-hygiene).
import { capitalize } from '@/lib/utils/native';
import Link from 'next/link';

export function TabButton({ isActive, title, href }: { isActive?: boolean; title: string; href: string }) {
  return (
    <Link aria-label={title} className="flex cursor-pointer flex-col items-center gap-2" href={href}>
      <h2
        className={cn(
          isActive ? 'font-bold text-foreground' : 'font-semibold text-muted-foreground hover:text-muted-foreground/70',
        )}>
        {capitalize(title)}
      </h2>
      {isActive && <div className="h-[2px] w-full bg-foreground" />}
    </Link>
  );
}
