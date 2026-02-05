import 'server-only';

/**
 * The database only stores the `fileName` of the files (image/video),
 * use this function to get the full Supabase Storage URL of the file.
 *
 * @param fileName The filename of the image or video.
 * @returns The full URL of the image or video.
 */
export function fileNameToUrl(fileName: string | null) {
  if (!fileName) return null;

  // If it's already a full URL (e.g., from old S3 or external source), return as-is
  if (fileName.startsWith('http://') || fileName.startsWith('https://')) {
    return fileName;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const bucketName = process.env.SUPABASE_STORAGE_BUCKET_PRIVATE || 'user-uploads';

  return `${supabaseUrl}/storage/v1/object/public/${bucketName}/${fileName}`;
}
