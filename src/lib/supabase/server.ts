import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Server-side Supabase client (uses service role key for admin operations)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Storage bucket names
export const STORAGE_BUCKETS = {
  PUBLIC: process.env.SUPABASE_STORAGE_BUCKET_PUBLIC || 'campaign-assets',
  PRIVATE: process.env.SUPABASE_STORAGE_BUCKET_PRIVATE || 'user-uploads',
} as const;
