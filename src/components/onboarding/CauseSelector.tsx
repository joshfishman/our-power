'use client';

import { cn } from '@/lib/cn';
import { Check } from '@/svg_components';

interface Cause {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  description: string | null;
}

interface CauseSelectorProps {
  causes: Cause[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  minRequired?: number;
}

export function CauseSelector({ causes, selectedIds, onSelectionChange, minRequired = 4 }: CauseSelectorProps) {
  const toggleCause = (causeId: string) => {
    if (selectedIds.includes(causeId)) {
      onSelectionChange(selectedIds.filter((id) => id !== causeId));
    } else {
      onSelectionChange([...selectedIds, causeId]);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {minRequired > 0 ? `Select at least ${minRequired} causes` : 'Select causes that matter to you (optional)'}
        </p>
        <span className={cn('text-sm font-medium', selectedIds.length > 0 ? 'text-sky-500' : 'text-muted-foreground')}>
          {selectedIds.length} selected
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {causes.map((cause) => {
          const isSelected = selectedIds.includes(cause.id);
          return (
            <button
              key={cause.id}
              type="button"
              onClick={() => toggleCause(cause.id)}
              className={cn(
                'relative flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all',
                'hover:border-primary/50 hover:bg-primary/5',
                isSelected ? 'border-primary bg-primary/10' : 'border-border bg-background',
              )}>
              {/* Icon */}
              <span className="text-2xl" role="img" aria-label={cause.name}>
                {cause.icon || '📌'}
              </span>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <p className="font-medium">{cause.name}</p>
                {cause.description && <p className="line-clamp-1 text-xs text-muted-foreground">{cause.description}</p>}
              </div>

              {/* Check indicator */}
              {isSelected && (
                <div
                  className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary"
                  style={{ backgroundColor: cause.color || undefined }}>
                  <Check className="h-3 w-3 text-white" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
