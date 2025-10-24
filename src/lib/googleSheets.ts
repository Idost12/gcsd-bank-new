// src/lib/googleSheets.ts
// Google Sheets backend to replace Supabase
// Updated: October 24, 2025 - Enhanced CSV parsing for complex JSON data

type KVValue = unknown;

// Configuration - you'll need to set these up
const SHEET_ID = import.meta.env.VITE_GOOGLE_SHEET_ID as string | undefined;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY as string | undefined;
const SERVICE_ACCOUNT_EMAIL = import.meta.env.VITE_GOOGLE_SERVICE_ACCOUNT_EMAIL as string | undefined;
const SERVICE_ACCOUNT_PRIVATE_KEY = import.meta.env.VITE_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY as string | undefined;

// Fallback to memory if no Google Sheets config
let kvMemory = new Map<string, KVValue>();

// Google Sheets API base URL
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// Cache to avoid excessive API calls
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 5000; // 5 seconds - shorter cache for better sync

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

  // Use a simpler approach - make the sheet publicly readable and use the service account email
  // This avoids the complex JWT signing in the browser
  console.log("🔑 Using Service Account authentication");
  
  // For now, we'll use the service account email as a basic auth approach
  // This is a simplified solution that should work for basic operations
  return SERVICE_ACCOUNT_EMAIL;
}

// Get all data from the sheet
async function getAllSheetData(): Promise<Record<string, any>> {
  if (!SHEET_ID) {
    console.warn("[GCS] Missing Google Sheets config; using memory fallback");
    return Object.fromEntries(kvMemory);
  }

  try {
    // Use a simple approach: read from Google Sheets CSV export
    // This works for multi-user scenarios
    const response = await fetch(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const csvText = await response.text();
    console.log("📄 Raw CSV from Google Sheets:", csvText.substring(0, 500) + "...");
    
    const lines = csvText.split('\n');
    const result: Record<string, any> = {};

    // Skip header row and process data
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && line !== 'Key,"""""""""""""""Value"""""""""""""""') {
        console.log("📝 Processing line:", line.substring(0, 100) + "...");
        
        // Find the first comma to separate key from value
        const firstCommaIndex = line.indexOf(',');
        if (firstCommaIndex > 0) {
          const key = line.substring(0, firstCommaIndex);
          let value = line.substring(firstCommaIndex + 1);
          
          console.log("🔑 Key:", key, "Value:", value.substring(0, 50) + "...");
          
          if (key && value) {
            try {
              // Remove all the extra quotes that Google Sheets adds
              const cleanValue = value.replace(/^"+|"+$/g, '').replace(/""/g, '"');
              result[key] = JSON.parse(cleanValue);
              console.log("✅ Successfully parsed:", key);
            } catch (error) {
              console.log("❌ JSON parse failed for", key, ":", error);
              // If JSON parsing fails, try to clean it more aggressively
              try {
                const moreCleanValue = value.replace(/^"+|"+$/g, '').replace(/""/g, '"').replace(/\\"/g, '"');
                result[key] = JSON.parse(moreCleanValue);
                console.log("✅ Successfully parsed after cleaning:", key);
              } catch {
                console.log("❌ Still failed, using raw value for:", key);
                // If still fails, use the raw value
                result[key] = value.replace(/^"+|"+$/g, '');
              }
            }
          }
        }
      }
    }

    console.log("📖 Successfully read data from Google Sheets:", Object.keys(result).length, "keys");
    console.log("📊 Sample data:", Object.entries(result).slice(0, 3));
    
    // If no data was parsed, try to use memory fallback
    if (Object.keys(result).length === 0) {
      console.log("⚠️ No data parsed from CSV, using memory fallback");
      return Object.fromEntries(kvMemory);
    }
    
    return result;
  } catch (error) {
    console.warn("[GCS] Google Sheets read failed; using memory fallback:", error);
    return Object.fromEntries(kvMemory);
  }
}

// Update the entire sheet with new data
async function updateSheetData(data: Record<string, any>): Promise<void> {
  if (!SHEET_ID) {
    console.warn("[GCS] Missing Google Sheets config; using memory fallback");
    // Update memory
    for (const [key, value] of Object.entries(data)) {
      kvMemory.set(key, value);
    }
    return;
  }

  try {
    // Use a hidden iframe to submit data without popups
    const scriptUrl = `https://script.google.com/macros/s/AKfycbyvqoO-IHAfVlUCOhlIPv6dgXg0j7yqHF6ccMnRvcePvL8thCUZuUq17ldS0KJlsThC8g/exec`;
    
    // Create a hidden iframe
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.name = 'hiddenFrame';
    document.body.appendChild(iframe);
    
    // Create a form to submit data via GET request (bypasses CORS)
    const form = document.createElement('form');
    form.method = 'GET';
    form.action = scriptUrl;
    form.target = 'hiddenFrame';
    form.style.display = 'none';
    
    // Add data as hidden inputs
    const sheetIdInput = document.createElement('input');
    sheetIdInput.type = 'hidden';
    sheetIdInput.name = 'sheetId';
    sheetIdInput.value = SHEET_ID;
    form.appendChild(sheetIdInput);
    
    const dataInput = document.createElement('input');
    dataInput.type = 'hidden';
    dataInput.name = 'data';
    dataInput.value = JSON.stringify(data);
    form.appendChild(dataInput);
    
    // Submit the form
    document.body.appendChild(form);
    form.submit();
    
    // Clean up after a short delay
    setTimeout(() => {
      document.body.removeChild(form);
      document.body.removeChild(iframe);
    }, 2000); // Increased delay to ensure Google Sheets processes the data
    
    console.log("✅ Successfully submitted data to Google Sheets via Apps Script");
    
    // Clear cache to force fresh read on next access
    cache.clear();
    console.log("🔄 Cache cleared - next read will be fresh from Google Sheets");
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
  console.log(`💾 Setting ${key} to:`, val);
  const allData = await getCachedOrFetch('all_data', getAllSheetData);
  allData[key] = val;
  await updateSheetData(allData);
  
  // Force a small delay to ensure data is written before continuing
  await new Promise(resolve => setTimeout(resolve, 1000));
}

export async function kvGet<T = KVValue>(key: string): Promise<T | null> {
  const allData = await getCachedOrFetch('all_data', getAllSheetData);
  const result = (allData[key] ?? null) as T | null;
  console.log(`📖 Getting ${key}:`, result);
  return result;
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
            console.log(`🔄 Live update detected: ${event} on ${key}`);
            changeHandlers.forEach(h => h({ event, key, val: value }));
          }
        }
        
        // Check for deletions
        for (const key of Object.keys(lastData)) {
          if (!(key in currentData)) {
            console.log(`🔄 Live update detected: DELETE on ${key}`);
            changeHandlers.forEach(h => h({ event: "DELETE", key }));
          }
        }
        
        lastData = currentData;
      } catch (error) {
        console.warn("[GCS] Polling error:", error);
      }
    }, 3000); // Poll every 3 seconds for faster updates
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

// Force refresh function to clear cache and get fresh data
export async function forceRefresh(): Promise<void> {
  console.log("🔄 Forcing refresh - clearing cache");
  cache.clear();
  await getAllSheetData();
}

// Test function to debug Google Sheets connection
export async function testGoogleSheetsConnection(): Promise<void> {
  console.log("🧪 Testing Google Sheets connection...");
  
  if (!SHEET_ID) {
    console.error("❌ No SHEET_ID configured");
    return;
  }
  
  try {
    const response = await fetch(
      `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`
    );
    
    if (!response.ok) {
      console.error("❌ HTTP Error:", response.status, response.statusText);
      return;
    }
    
    const csvText = await response.text();
    console.log("✅ Successfully connected to Google Sheets");
    console.log("📄 CSV Length:", csvText.length);
    console.log("📄 First 200 chars:", csvText.substring(0, 200));
    
    // Try to parse the CSV
    const lines = csvText.split('\n');
    console.log("📄 Number of lines:", lines.length);
    console.log("📄 First few lines:", lines.slice(0, 3));
    
  } catch (error) {
    console.error("❌ Connection test failed:", error);
  }
}

// Export for compatibility
export const supabase = null; // No longer using Supabase
