// src/lib/db.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type KVValue = unknown;

const url  = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let supabase: SupabaseClient | null = null;
let kvMemory = new Map<string, KVValue>();

if (url && anon) {
  try { supabase = createClient(url, anon); }
  catch (e) { console.warn("[GCS] Supabase init failed, using memory fallback.", e); supabase = null; }
} else {
  console.warn("[GCS] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY; using memory fallback.");
}

const TABLE = "kv";

export async function kvSet<T = KVValue>(key: string, val: T): Promise<void> {
  if (!supabase) { kvMemory.set(key, val); return; }
  const { error } = await supabase.from(TABLE).upsert({ key, val }, { onConflict: "key" }).select("key").single();
  if (error) { console.warn("[GCS] kvSet failed; memory fallback:", error); kvMemory.set(key, val); }
  else { lastWriteJson.set(key, stableStringify(val)); }
}

export async function kvGet<T = KVValue>(key: string): Promise<T | null> {
  if (!supabase) return (kvMemory.has(key) ? (kvMemory.get(key) as T) : null);
  const { data, error } = await supabase.from(TABLE).select("val").eq("key", key).single();
  if (error) { if ((error as any).code !== "PGRST116"){ console.warn("[GCS] kvGet failed; memory:", error); return (kvMemory.has(key)?(kvMemory.get(key) as T):null); } return null; }
  return (data?.val ?? null) as T | null;
}

export async function kvDelete(key: string): Promise<void> {
  if (!supabase) { 
    kvMemory.delete(key); 
    return; 
  }
  const { error } = await supabase.from(TABLE).delete().eq("key", key);
  if (error) { 
    console.warn("[GCS] kvDelete failed; memory fallback:", error); 
    kvMemory.delete(key); 
  } else { 
    lastWriteJson.delete(key); 
  }
}

export function onKVChange(
  handler: (payload: { event: "INSERT" | "UPDATE" | "DELETE"; key?: string; val?: any }) => void
){
  if (!supabase) return () => {};
  const ch = supabase
    .channel("kv-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "kv" }, (payload: any)=>{
      const event = payload.eventType as "INSERT"|"UPDATE"|"DELETE";
      const row = payload.new || payload.old || {};
      handler({ event, key: row.key, val: row.val });
    })
    .subscribe();
  return ()=> { try { supabase!.removeChannel(ch); } catch {} };
}

// === helpers to avoid write loops (optional, but recommended) ===
const lastWriteJson = new Map<string, string>();
function stableStringify(v: unknown){ try { return JSON.stringify(v); } catch { return ""; } }

export async function kvSetIfChanged<T = KVValue>(key: string, val: T): Promise<void> {
  const next = stableStringify(val);
  if (lastWriteJson.get(key) === next) return;
  await kvSet<T>(key, val);
}

export async function kvGetRemember<T = KVValue>(key: string): Promise<T | null> {
  const v = await kvGet<T>(key);
  if (v !== null) lastWriteJson.set(key, stableStringify(v));
  return v;
}

export { supabase };
