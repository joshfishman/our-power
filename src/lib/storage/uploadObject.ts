import 'server-only';
import { supabaseAdmin, STORAGE_BUCKETS } from '@/lib/supabase/server';

// Map file extensions to MIME types
const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

export async function uploadObject(file: Buffer, fileName: string, type: string) {
  const bucketName = STORAGE_BUCKETS.PRIVATE;
  const contentType = MIME_TYPES[type.toLowerCase()] || `application/${type}`;

  const { error } = await supabaseAdmin.storage.from(bucketName).upload(fileName, file, {
    contentType,
    cacheControl: '3600',
    upsert: true,
  });

  if (error) {
    throw new Error(`Failed to upload file: ${error.message}`);
  }
}
