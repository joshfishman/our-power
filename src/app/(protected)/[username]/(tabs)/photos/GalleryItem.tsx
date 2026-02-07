import { cn } from '@/lib/cn';
import { Play } from '@/svg_components';
import { VisualMediaType } from '@/generated/prisma/client';
import { mergeProps, useFocusRing, usePress } from 'react-aria';
import Image from 'next/image';

export function GalleryItem({ type, url, onClick }: { type: VisualMediaType; url: string; onClick: () => void }) {
  const { pressProps, isPressed } = usePress({
    onPress: onClick,
  });
  const { focusProps, isFocusVisible } = useFocusRing();

  return (
    <div
      {...mergeProps(pressProps, focusProps)}
      role="button"
      tabIndex={0}
      aria-label="Open visual media"
      className={cn('group relative focus:outline-none', isFocusVisible && 'border-4 border-sky-500')}>
      {type === 'PHOTO' ? (
        <Image
          src={url}
          alt="Gallery"
          fill
          sizes="(max-width: 768px) 50vw, 25vw"
          className={cn('object-cover', isPressed && 'brightness-75')}
        />
      ) : (
        <>
          <Play
            width={36}
            height={36}
            className="absolute left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] stroke-sky-100 transition-transform group-hover:scale-125"
          />
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video className="h-full w-full object-cover">
            <source src={url} type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        </>
      )}
    </div>
  );
}
