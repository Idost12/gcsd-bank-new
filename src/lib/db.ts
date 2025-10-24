// src/lib/db.ts
// Now using Google Sheets as backend instead of Supabase
// Updated: October 24, 2025 - Migration complete

// Re-export all functions from Google Sheets implementation
export {
  kvSet,
  kvGet,
  kvDelete,
  onKVChange,
  kvSetIfChanged,
  kvGetRemember,
  forceRefresh,
  supabase
} from './googleSheets';
