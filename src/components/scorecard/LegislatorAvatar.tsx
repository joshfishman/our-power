'use client';

import Image from 'next/image';
import { useCallback, useMemo, useState } from 'react';
import { getAvatarFallback } from '@/lib/getAvatarFallback';
import { cn } from '@/lib/cn';

interface LegislatorAvatarProps {
  fullName: string;
  photoUrl: string | null | undefined;
  size?: number;
  className?: string;
}

export function LegislatorAvatar({ fullName, photoUrl, size = 40, className }: LegislatorAvatarProps) {
  const [errored, setErrored] = useState(false);
  const handleError = useCallback(() => setErrored(true), []);
  const imageStyle = useMemo(() => ({ width: size, height: size }), [size]);
  const fallbackStyle = useMemo(
    () => ({ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }),
    [size],
  );
  const showImage = Boolean(photoUrl) && !errored;

  if (showImage) {
    return (
      <span
        style={imageStyle}
        className={cn(
          'relative inline-block shrink-0 overflow-hidden rounded-full bg-surface-elevated ring-1 ring-border',
          className,
        )}>
        <Image
          src={photoUrl as string}
          alt={fullName}
          fill
          sizes={`${size}px`}
          className="object-cover"
          unoptimized
          onError={handleError}
        />
      </span>
    );
  }
  return (
    <span
      style={fallbackStyle}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-secondary font-mono font-semibold uppercase text-secondary-foreground ring-1 ring-border',
        className,
      )}
      aria-label={fullName}>
      {getAvatarFallback(fullName)}
    </span>
  );
}
