// src/lib/db.ts
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL!
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnon)

// Key–Value helpers (all live in public.kv)
export async function kvGet<T = any>(key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from('kv')
    .select('val')
    .eq('key', key)
    .single()

  if (error?.code === 'PGRST116') return null // not found
  if (error) throw error
  return (data?.val ?? null) as T | null
}

export async function kvSet<T = any>(key: string, val: T): Promise<void> {
  const { error } = await supabase
    .from('kv')
    .upsert({ key, val }) // updated_at is auto by trigger
    .select()
    .single()

  if (error) throw error
}
