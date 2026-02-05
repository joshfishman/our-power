import { supabase, STORAGE_BUCKETS } from './client';
import { supabaseAdmin } from './server';

/**
 * Upload a file to Supabase Storage
 */
export async function uploadFile(
  file: File,
  path: string,
  bucket: keyof typeof STORAGE_BUCKETS = 'PUBLIC',
): Promise<{ url: string; error: Error | null }> {
  const bucketName = STORAGE_BUCKETS[bucket];

  const { data, error } = await supabase.storage.from(bucketName).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });

  if (error) {
    return { url: '', error: new Error(error.message) };
  }

  const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(data.path);

  return { url: urlData.publicUrl, error: null };
}

/**
 * Delete a file from Supabase Storage
 */
export async function deleteFile(
  path: string,
  bucket: keyof typeof STORAGE_BUCKETS = 'PUBLIC',
): Promise<{ error: Error | null }> {
  const bucketName = STORAGE_BUCKETS[bucket];

  const { error } = await supabaseAdmin.storage.from(bucketName).remove([path]);

  if (error) {
    return { error: new Error(error.message) };
  }

  return { error: null };
}

/**
 * Get public URL for a file
 */
export function getPublicUrl(path: string, bucket: keyof typeof STORAGE_BUCKETS = 'PUBLIC'): string {
  const bucketName = STORAGE_BUCKETS[bucket];

  const { data } = supabase.storage.from(bucketName).getPublicUrl(path);

  return data.publicUrl;
}

/**
 * Upload campaign graphic
 */
export async function uploadCampaignGraphic(
  file: File,
  campaignId: string,
): Promise<{ url: string; error: Error | null }> {
  const ext = file.name.split('.').pop();
  const path = `campaigns/${campaignId}/${Date.now()}.${ext}`;
  return uploadFile(file, path, 'PUBLIC');
}

/**
 * Upload user profile photo
 */
export async function uploadProfilePhoto(file: File, userId: string): Promise<{ url: string; error: Error | null }> {
  const ext = file.name.split('.').pop();
  const path = `users/${userId}/profile.${ext}`;
  return uploadFile(file, path, 'PRIVATE');
}
