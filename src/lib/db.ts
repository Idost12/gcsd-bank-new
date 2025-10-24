// src/lib/db.ts
// Now using Google Sheets as backend instead of Supabase

// Re-export all functions from Google Sheets implementation
export {
  kvSet,
  kvGet,
  kvDelete,
  onKVChange,
  kvSetIfChanged,
  kvGetRemember,
  supabase
} from './googleSheets';
