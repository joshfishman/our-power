import Link from 'next/link';
import Image from 'next/image';
import { FallbackProfilePhoto } from './FallbackProfilePhoto';

export function ProfilePhoto({
  name,
  photoUrl,
  username,
  fallbackAvatarClassName,
}: {
  name: string;
  username: string;
  photoUrl?: string | null;
  fallbackAvatarClassName?: string;
}) {
  return (
    <Link href={`/${username}`} className="block h-full w-full">
      {photoUrl ? (
        <span className="relative block h-full w-full cursor-pointer">
          <Image
            src={photoUrl}
            alt={`${name}'s avatar`}
            fill
            sizes="100px"
            className="rounded-full bg-muted object-cover"
          />
        </span>
      ) : (
        <FallbackProfilePhoto name={name} className={fallbackAvatarClassName} />
      )}
    </Link>
  );
}
