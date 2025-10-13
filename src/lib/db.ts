// src/lib/db.ts
import { createClient } from '@supabase/supabase-js';

const url  = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// In the client we should only use the public anon key and read-only/kv writes.
export const supabase = createClient(url, anon);

// Helpers for the public.kv table
export async function getKV<T = any>(key: string) {
  const { data, error } = await supabase
    .from('kv')
    .select('val')
    .eq('key', key)
    .single();
  if (error) throw error;
  return (data?.val as T) ?? null;
}

export async function setKV<T = any>(key: string, val: T) {
  const { error } = await supabase
    .from('kv')
    .upsert({ key, val })
    .select()
    .single();
  if (error) throw error;
}
