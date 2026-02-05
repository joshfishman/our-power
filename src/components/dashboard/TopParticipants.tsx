'use client';

import { cn } from '@/lib/cn';
import Image from 'next/image';

interface Participant {
  userId: string;
  name: string;
  profilePhoto?: string | null;
  completedActions: number;
}

interface TopParticipantsProps {
  participants: Participant[];
  className?: string;
}

export function TopParticipants({ participants, className }: TopParticipantsProps) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-6', className)}>
      <h3 className="text-lg font-semibold">Top Participants</h3>
      <p className="text-sm text-muted-foreground">By completed actions</p>

      <div className="mt-4 space-y-3">
        {participants.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No completed actions yet</p>
        ) : (
          participants.map((participant, index) => (
            <div key={participant.userId} className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {index + 1}
              </div>

              {participant.profilePhoto ? (
                <Image
                  src={participant.profilePhoto}
                  alt={participant.name}
                  width={36}
                  height={36}
                  className="rounded-full"
                />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-medium">
                  {participant.name.charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{participant.name}</p>
              </div>

              <div className="text-right">
                <p className="font-semibold">{participant.completedActions}</p>
                <p className="text-xs text-muted-foreground">actions</p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
