// src/lib/db.ts
import { createClient } from '@supabase/supabase-js';

// Read from Vite env (set in Netlify project env and/or local .env)
const url  = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anon) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Set them in Netlify → Site settings → Build & deploy → Environment variables.'
  );
}

export const supabase = createClient(url, anon);

const TABLE = 'kv';

/** Upsert a JSON value by key */
export async function kvSet<T = unknown>(key: string, val: T): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .upsert({ key, val }, { onConflict: 'key' })
    .select('key')
    .single();

  if (error) throw error;
}

/** Get a JSON value by key. Returns null if not found. */
export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('val')
    .eq('key', key)
    .single();

  // "Row not found" is OK → return null
  if (error && (error as any).code !== 'PGRST116') {
    throw error;
  }

  return (data?.val ?? null) as T | null;
}
