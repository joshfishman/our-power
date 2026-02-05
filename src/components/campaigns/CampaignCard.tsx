'use client';

import Link from 'next/link';
import { cn } from '@/lib/cn';
import { TwoPeople, Calendar } from '@/svg_components';

interface CampaignCardProps {
  campaign: {
    id: string;
    name: string;
    description: string;
    type: string;
    status: string;
    imageUrl?: string | null;
    cause: {
      id: string;
      name: string;
      icon: string | null;
      color: string | null;
    };
    org: {
      id: string;
      name: string;
      logoUrl: string | null;
    };
    _count: {
      members: number;
      actions: number;
    };
  };
}

const typeLabels: Record<string, string> = {
  LEGISLATIVE: 'Legislative',
  FISCAL: 'Fiscal',
  CRIMINAL_JUSTICE: 'Criminal Justice',
  ELECTORAL: 'Electoral',
  COMMUNITY: 'Community',
  OTHER: 'Other',
};

export function CampaignCard({ campaign }: CampaignCardProps) {
  return (
    <Link href={`/campaigns/${campaign.id}`} className="block">
      <article
        className={cn(
          'rounded-xl border border-border bg-card p-4 transition-all',
          'hover:border-primary/50 hover:shadow-md',
        )}>
        {/* Header with cause badge */}
        <div className="mb-3 flex items-start justify-between">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium"
            style={{ backgroundColor: `${campaign.cause.color}20`, color: campaign.cause.color || undefined }}>
            <span>{campaign.cause.icon}</span>
            {campaign.cause.name}
          </span>
          <span className="text-xs text-muted-foreground">{typeLabels[campaign.type]}</span>
        </div>

        {/* Title and description */}
        <h3 className="mb-2 line-clamp-2 text-lg font-semibold">{campaign.name}</h3>
        <p className="mb-4 line-clamp-2 text-sm text-muted-foreground">{campaign.description}</p>

        {/* Organization */}
        <div className="mb-4 flex items-center gap-2">
          {campaign.org.logoUrl ? (
            <img src={campaign.org.logoUrl} alt={campaign.org.name} className="h-5 w-5 rounded-full object-cover" />
          ) : (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs">
              {campaign.org.name[0]}
            </div>
          )}
          <span className="text-sm text-muted-foreground">{campaign.org.name}</span>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <TwoPeople className="h-4 w-4" />
            {campaign._count.members} members
          </span>
          <span className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            {campaign._count.actions} actions
          </span>
        </div>
      </article>
    </Link>
  );
}
