// src/lib/db.ts
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL!;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in Netlify > Site settings > Environment variables.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLE = 'kv';

export async function kvSet<T = any>(key: string, val: T): Promise<void> {
  const row = { key, val, updated_at: new Date().toISOString() };
  const { error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'key' })
    .select('key')
    .single();

  if (error) throw error;
}

export async function kvGet<T = any>(key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('val')
    .eq('key', key)
    .single();

  // Row-not-found is OK → return null instead of error
  if (error && (error.code === 'PGRST116' || /Row not found/i.test(error.message))) {
    return null;
  }
  if (error) throw error;

  return (data?.val as T) ?? null;
}
