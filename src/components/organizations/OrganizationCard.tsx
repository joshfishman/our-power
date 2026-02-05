'use client';

import Link from 'next/link';
import { cn } from '@/lib/cn';
import { BuildingBusinessOffice, TwoPeople } from '@/svg_components';

interface OrganizationCardProps {
  organization: {
    id: string;
    name: string;
    description?: string | null;
    logoUrl?: string | null;
    website?: string | null;
    managers: {
      id: string;
      name: string | null;
      image: string | null;
    }[];
    _count: {
      campaigns: number;
    };
  };
  isManager?: boolean;
}

export function OrganizationCard({ organization, isManager }: OrganizationCardProps) {
  return (
    <Link href={`/organizations/${organization.id}`} className="block">
      <article
        className={cn(
          'rounded-xl border border-border bg-card p-4 transition-all',
          'hover:border-primary/50 hover:shadow-md',
        )}>
        {/* Header with logo */}
        <div className="mb-3 flex items-start gap-3">
          {organization.logoUrl ? (
            <img src={organization.logoUrl} alt={organization.name} className="h-12 w-12 rounded-lg object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <BuildingBusinessOffice className="h-6 w-6 text-primary" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="font-semibold">{organization.name}</h3>
            {isManager && (
              <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Manager
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        {organization.description && (
          <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">{organization.description}</p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <TwoPeople className="h-4 w-4" />
            {organization._count.campaigns} campaign{organization._count.campaigns !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1">
            {organization.managers.length} manager{organization.managers.length !== 1 ? 's' : ''}
          </span>
        </div>
      </article>
    </Link>
  );
}
