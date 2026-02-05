import 'server-only';
import { supabaseAdmin, STORAGE_BUCKETS } from '@/lib/supabase/server';

export async function deleteObject(fileName: string) {
  const bucketName = STORAGE_BUCKETS.PRIVATE;

  const { error } = await supabaseAdmin.storage.from(bucketName).remove([fileName]);

  if (error) {
    throw new Error(`Failed to delete file: ${error.message}`);
  }
}
