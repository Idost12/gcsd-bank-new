// src/lib/testGoogleSheets.ts
// Simple test to verify Google Sheets integration works
// Updated: October 24, 2025 - Google Sheets migration complete

import { kvSet, kvGet, kvDelete } from './googleSheets';

export async function testGoogleSheetsIntegration(): Promise<boolean> {
  try {
    console.log('🧪 Testing Google Sheets integration...');
    
    // Test 1: Set a test value
    const testKey = 'test-key-' + Date.now();
    const testValue = { message: 'Hello from Google Sheets!', timestamp: new Date().toISOString() };
    
    console.log('📝 Setting test value...');
    await kvSet(testKey, testValue);
    
    // Test 2: Get the value back
    console.log('📖 Reading test value...');
    const retrievedValue = await kvGet(testKey);
    
    if (!retrievedValue) {
      console.error('❌ Failed to retrieve test value');
      return false;
    }
    
    // Test 3: Verify the data matches
    if (JSON.stringify(retrievedValue) !== JSON.stringify(testValue)) {
      console.error('❌ Retrieved value does not match original');
      console.log('Original:', testValue);
      console.log('Retrieved:', retrievedValue);
      return false;
    }
    
    // Test 4: Clean up
    console.log('🗑️ Cleaning up test data...');
    await kvDelete(testKey);
    
    console.log('✅ Google Sheets integration test passed!');
    return true;
    
  } catch (error) {
    console.error('❌ Google Sheets integration test failed:', error);
    return false;
  }
}

// Auto-run test when this module is imported (for development)
if (import.meta.env.DEV) {
  testGoogleSheetsIntegration().then(success => {
    if (success) {
      console.log('🎉 Google Sheets backend is ready!');
    } else {
      console.warn('⚠️ Google Sheets backend has issues - check your configuration');
    }
  });
}
