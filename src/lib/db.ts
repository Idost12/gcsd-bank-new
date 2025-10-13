// src/lib/db.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

type KVValue = unknown;

const url  = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// If env is missing, keep UI usable with an in-memory fallback
let supabase: SupabaseClient | null = null;
let kvMemory = new Map<string, KVValue>();

if (url && anon) {
  try {
    supabase = createClient(url, anon, {
      realtime: { params: { eventsPerSecond: 5 } }, // gentle rate limit, safe default
    });
  } catch (e) {
    console.warn("[GCS] Supabase init failed, using in-memory KV fallback.", e);
    supabase = null;
  }
} else {
  console.warn("[GCS] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY; using in-memory KV fallback.");
}

const TABLE = "kv";

/* ------------------------------------------------------------------ */
/* Core KV ops                                                         */
/* ------------------------------------------------------------------ */

export async function kvSet<T = KVValue>(key: string, val: T): Promise<void> {
  if (!supabase) {
    kvMemory.set(key, val);
    return;
  }
  const { error } = await supabase
    .from(TABLE)
    .upsert({ key, val }, { onConflict: "key" })
    .select("key")
    .single();
  if (error) {
    console.warn("[GCS] kvSet failed, fallback memory:", error);
    kvMemory.set(key, val);
  } else {
    // remember last write so we don't echo it back (see helpers below)
    lastWriteJson.set(key, stableStringify(val));
  }
}

export async function kvGet<T = KVValue>(key: string): Promise<T | null> {
  if (!supabase) {
    return (kvMemory.has(key) ? (kvMemory.get(key) as T) : null);
  }
  const { data, error } = await supabase
    .from(TABLE)
    .select("val")
    .eq("key", key)
    .single();
  if (error) {
    // PGRST116 = row not found
    if ((error as any).code !== "PGRST116") {
      console.warn("[GCS] kvGet failed, using memory:", error);
      return (kvMemory.has(key) ? (kvMemory.get(key) as T) : null);
    }
    return null;
  }
  return (data?.val ?? null) as T | null;
}

/* ------------------------------------------------------------------ */
/* Realtime subscription                                               */
/* ------------------------------------------------------------------ */

/** Subscribe to INSERT/UPDATE/DELETE on public.kv */
export function onKVChange(
  handler: (payload: { event: "INSERT" | "UPDATE" | "DELETE"; key?: string; val?: any }) => void
) {
  if (!supabase) {
    // No realtime in memory mode
    return () => {};
  }
  const ch = supabase
    .channel("kv-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "kv" },
      (payload: any) => {
        const event = payload.eventType as "INSERT" | "UPDATE" | "DELETE";
        const row = payload.new || payload.old || {};
        handler({ event, key: row.key, val: row.val });
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // connected
      }
    });

  return () => {
    try { supabase!.removeChannel(ch); } catch {}
  };
}

/* ------------------------------------------------------------------ */
/* Quality-of-life helpers (optional but recommended)                  */
/* ------------------------------------------------------------------ */

/** Internal: remember last JSON we wrote per key to avoid echo churn */
const lastWriteJson = new Map<string, string>();
function stableStringify(v: unknown) {
  try { return JSON.stringify(v); } catch { return ""; }
}

/** Set only if the value actually changed (prevents write storms across tabs). */
export async function kvSetIfChanged<T = KVValue>(key: string, val: T): Promise<void> {
  const next = stableStringify(val);
  if (lastWriteJson.get(key) === next) return; // no-op
  await kvSet<T>(key, val);
}

/** Remember the first-read value so the next save doesn’t immediately echo. */
export async function kvGetRemember<T = KVValue>(key: string): Promise<T | null> {
  const v = await kvGet<T>(key);
  if (v !== null) lastWriteJson.set(key, stableStringify(v));
  return v;
}

// Export client if you need advanced calls elsewhere
export { supabase };
