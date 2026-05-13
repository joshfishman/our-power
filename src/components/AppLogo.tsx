import { cn } from '@/lib/cn';
import Image from 'next/image';
import React from 'react';

interface AppLogoProps {
  /** Size of the logo image in pixels */
  size?: number;
  /** Whether to show the "Our Power" text next to the logo */
  showText?: boolean;
  /** Text size class */
  textClass?: string;
  /** Additional class names for the wrapper */
  className?: string;
}

export function AppLogo({ size = 40, showText = true, textClass = 'text-2xl', className }: AppLogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
        style={{ width: size, height: size, backgroundColor: '#F5DEB3' }}>
        <Image src="/logo.png" alt="Our Power" width={size} height={size} className="object-contain" priority />
      </span>
      {showText && <span className={cn('font-bold text-primary', textClass)}>Our Power</span>}
    </span>
  );
}
