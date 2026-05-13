import prisma from '@/lib/prisma/prisma';
import { fileNameToUrl } from '@/lib/storage/fileNameToUrl';
import { GetVisualMedia } from '@/types/definitions';
import { getProfile } from '../../getProfile';
import { Gallery } from './Gallery';

export async function generateMetadata(props: { params: Promise<{ username: string }> }) {
  const params = await props.params;
  const profile = await getProfile(params.username);
  return {
    title: `Photos | ${profile?.name}` || 'Photos',
  };
}

async function getVisualMedia(userId: string) {
  const res = await prisma.visualMedia.findMany({
    where: { userId },
    orderBy: { id: 'desc' },
  });

  return res.map(
    (item): GetVisualMedia => ({
      type: item.type,
      url: fileNameToUrl(item.fileName)!,
    }),
  );
}

export default async function Page(props: { params: Promise<{ username: string }> }) {
  const params = await props.params;
  const profile = await getProfile(params.username);
  if (!profile) return <p>User not found.</p>;
  const visualMedia = await getVisualMedia(profile.id);
  return <Gallery visualMedia={visualMedia} />;
}
