// src/lib/googleSheets.ts
// Google Sheets backend to replace Supabase
// Updated: October 24, 2025 - Using Service Account authentication

type KVValue = unknown;

// Configuration - you'll need to set these up
const SHEET_ID = import.meta.env.VITE_GOOGLE_SHEET_ID as string | undefined;
const SERVICE_ACCOUNT_EMAIL = import.meta.env.VITE_GOOGLE_SERVICE_ACCOUNT_EMAIL as string | undefined;
const SERVICE_ACCOUNT_PRIVATE_KEY = import.meta.env.VITE_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY as string | undefined;

// Fallback to memory if no Google Sheets config
let kvMemory = new Map<string, KVValue>();

// Google Sheets API base URL
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Cache to avoid excessive API calls
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 30000; // 30 seconds

// Helper function to get cached data or fetch from API
async function getCachedOrFetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  const now = Date.now();
  
  if (cached && (now - cached.timestamp) < CACHE_DURATION) {
    return cached.data;
  }
  
  const data = await fetchFn();
  cache.set(key, { data, timestamp: now });
  return data;
}

// Get access token using service account
async function getAccessToken(): Promise<string> {
  if (!SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error("Missing service account credentials");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT"
  };

  const payload = {
    iss: SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  // Create JWT (simplified - in production, use a proper JWT library)
  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await crypto.subtle.importKey(
      "pkcs8",
      new TextEncoder().encode(SERVICE_ACCOUNT_PRIVATE_KEY),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    ),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
  const jwt = `${encodedHeader}.${encodedPayload}.${encodedSignature}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.statusText}`);
  }

  const data = await response.json();
  return data.access_token;
}

// Get all data from the sheet
async function getAllSheetData(): Promise<Record<string, any>> {
  if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_PRIVATE_KEY) {
    console.warn("[GCS] Missing Google Sheets config; using memory fallback");
    return Object.fromEntries(kvMemory);
  }

  try {
    const accessToken = await getAccessToken();
    const response = await fetch(
      `${SHEETS_API_BASE}/${SHEET_ID}/values/Data!A:B?access_token=${accessToken}`
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const result: Record<string, any> = {};

    if (data.values) {
      for (const row of data.values) {
        if (row.length >= 2) {
          const key = row[0];
          const value = row[1];
          try {
            result[key] = JSON.parse(value);
          } catch {
            result[key] = value;
          }
        }
      }
    }

    return result;
  } catch (error) {
    console.warn("[GCS] Google Sheets fetch failed; using memory fallback:", error);
    return Object.fromEntries(kvMemory);
  }
}

// Update the entire sheet with new data
async function updateSheetData(data: Record<string, any>): Promise<void> {
  if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_PRIVATE_KEY) {
    console.warn("[GCS] Missing Google Sheets config; using memory fallback");
    // Update memory
    for (const [key, value] of Object.entries(data)) {
      kvMemory.set(key, value);
    }
    return;
  }

  try {
    const accessToken = await getAccessToken();
    
    // Convert data to sheet format
    const values = Object.entries(data).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : JSON.stringify(value)
    ]);

    // Use batchUpdate with service account
    const response = await fetch(
      `${SHEETS_API_BASE}/${SHEET_ID}/values:batchUpdate?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: [{
            range: 'Data!A:B',
            values: values
          }]
        })
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    console.log("✅ Successfully updated Google Sheets with service account");
    
    // Update cache
    for (const [key, value] of Object.entries(data)) {
      cache.set(key, { data: value, timestamp: Date.now() });
    }
  } catch (error) {
    console.warn("[GCS] Google Sheets update failed; using memory fallback:", error);
    // Update memory as fallback
    for (const [key, value] of Object.entries(data)) {
      kvMemory.set(key, value);
    }
  }
}

// Google Sheets implementation of the KV store
export async function kvSet<T = KVValue>(key: string, val: T): Promise<void> {
  const allData = await getCachedOrFetch('all_data', getAllSheetData);
  allData[key] = val;
  await updateSheetData(allData);
}

export async function kvGet<T = KVValue>(key: string): Promise<T | null> {
  const allData = await getCachedOrFetch('all_data', getAllSheetData);
  return (allData[key] ?? null) as T | null;
}

export async function kvDelete(key: string): Promise<void> {
  const allData = await getCachedOrFetch('all_data', getAllSheetData);
  delete allData[key];
  await updateSheetData(allData);
}

// Real-time updates using polling (since Google Sheets doesn't have real-time subscriptions)
let changeHandlers: Array<(payload: { event: "INSERT" | "UPDATE" | "DELETE"; key?: string; val?: any }) => void> = [];
let pollingInterval: number | null = null;
let lastData: Record<string, any> = {};

export function onKVChange(
  handler: (payload: { event: "INSERT" | "UPDATE" | "DELETE"; key?: string; val?: any }) => void
): () => void {
  changeHandlers.push(handler);
  
  // Start polling if not already started
  if (!pollingInterval) {
    pollingInterval = window.setInterval(async () => {
      try {
        const currentData = await getAllSheetData();
        
        // Check for changes
        for (const [key, value] of Object.entries(currentData)) {
          if (!(key in lastData) || JSON.stringify(lastData[key]) !== JSON.stringify(value)) {
            const event = key in lastData ? "UPDATE" : "INSERT";
            changeHandlers.forEach(h => h({ event, key, val: value }));
          }
        }
        
        // Check for deletions
        for (const key of Object.keys(lastData)) {
          if (!(key in currentData)) {
            changeHandlers.forEach(h => h({ event: "DELETE", key }));
          }
        }
        
        lastData = currentData;
      } catch (error) {
        console.warn("[GCS] Polling error:", error);
      }
    }, 5000); // Poll every 5 seconds
  }
  
  // Return unsubscribe function
  return () => {
    const index = changeHandlers.indexOf(handler);
    if (index > -1) {
      changeHandlers.splice(index, 1);
    }
    
    // Stop polling if no more handlers
    if (changeHandlers.length === 0 && pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  };
}

// Helper functions to avoid write loops
const lastWriteJson = new Map<string, string>();

function stableStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

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

// Export for compatibility
export const supabase = null; // No longer using Supabase
