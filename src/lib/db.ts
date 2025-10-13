// src/lib/db.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type KVValue = unknown;

const url  = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// Graceful fallback if env missing/misconfigured
let supabase: SupabaseClient | null = null;
let kvMemory = new Map<string, KVValue>();

if (url && anon) {
  try { supabase = createClient(url, anon); }
  catch (e) {
    console.warn("[GCS] Supabase init failed, using in-memory KV fallback.", e);
    supabase = null;
  }
} else {
  console.warn("[GCS] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY; using in-memory KV fallback.");
}

const TABLE = "kv";

export async function kvSet<T = KVValue>(key: string, val: T): Promise<void> {
  if (!supabase) { kvMemory.set(key, val); return; }
  const { error } = await supabase.from(TABLE).upsert({ key, val }, { onConflict: "key" }).select("key").single();
  if (error) {
    console.warn("[GCS] kvSet failed, falling back to memory:", error);
    kvMemory.set(key, val);
  }
}

export async function kvGet<T = KVValue>(key: string): Promise<T | null> {
  if (!supabase) return (kvMemory.has(key) ? (kvMemory.get(key) as T) : null);
  const { data, error } = await supabase.from(TABLE).select("val").eq("key", key).single();
  if (error) {
    if ((error as any).code !== "PGRST116") {
      console.warn("[GCS] kvGet failed, using memory fallback:", error);
      return (kvMemory.has(key) ? (kvMemory.get(key) as T) : null);
    }
    return null;
  }
  return (data?.val ?? null) as T | null;
}

// 🔔 Realtime (INSERT/UPDATE/DELETE on public.kv)
export function onKVChange(
  keys: string[],
  handler: (key: string, value: any | null) => void
): () => void {
  if (!supabase) return () => {};
  const ch = supabase
    .channel("kv-listener")
    .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, (payload: any) => {
      const changedKey: string | undefined = payload?.new?.key ?? payload?.old?.key;
      if (!changedKey || !keys.includes(changedKey)) return;
      const newVal = payload?.new?.val ?? null;
      handler(changedKey, newVal);
    })
    .subscribe();
  return () => { try { supabase?.removeChannel(ch); } catch {} };
}

export { supabase };
