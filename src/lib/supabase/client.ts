import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Client-side Supabase client (uses anon key)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Storage bucket names
export const STORAGE_BUCKETS = {
  PUBLIC: process.env.SUPABASE_STORAGE_BUCKET_PUBLIC || 'campaign-assets',
  PRIVATE: process.env.SUPABASE_STORAGE_BUCKET_PRIVATE || 'user-uploads',
} as const;
