// src/lib/db.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';

type KVValue = unknown;

const url  = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// If env vars are missing (e.g., misconfigured Netlify), DON'T crash the app.
// Fall back to a no-op in-memory store so the UI still renders.
let supabase: SupabaseClient | null = null;
let kvMemory = new Map<string, KVValue>();

if (url && anon) {
  try {
    supabase = createClient(url, anon);
    // Optional: simple ping to surface errors early (won't throw on failure)
    // void supabase.from('kv').select('key').limit(1);
  } catch (e) {
    console.warn('[GCS] Supabase init failed, using in-memory KV fallback.', e);
    supabase = null;
  }
} else {
  console.warn('[GCS] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY; using in-memory KV fallback.');
}

const TABLE = 'kv';

export async function kvSet<T = KVValue>(key: string, val: T): Promise<void> {
  if (!supabase) {
    kvMemory.set(key, val);
    return;
  }
  const { error } = await supabase
    .from(TABLE)
    .upsert({ key, val }, { onConflict: 'key' })
    .select('key')
    .single();
  if (error) {
    console.warn('[GCS] kvSet failed, falling back to memory:', error);
    kvMemory.set(key, val);
  }
}

export async function kvGet<T = KVValue>(key: string): Promise<T | null> {
  if (!supabase) {
    return (kvMemory.has(key) ? (kvMemory.get(key) as T) : null);
  }
  const { data, error } = await supabase
    .from(TABLE)
    .select('val')
    .eq('key', key)
    .single();
  if (error) {
    // PGRST116 = row not found; any other error → warn and return memory
    if ((error as any).code !== 'PGRST116') {
      console.warn('[GCS] kvGet failed, using memory fallback:', error);
      return (kvMemory.has(key) ? (kvMemory.get(key) as T) : null);
    }
    return null;
  }
  return (data?.val ?? null) as T | null;
}

// Export the client for optional advanced use (may be null in fallback)
export { supabase };
