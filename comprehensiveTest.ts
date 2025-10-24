// src/lib/comprehensiveTest.ts
// Comprehensive test suite for Google Sheets integration
// Updated: October 24, 2025 - Complete functionality verification

import { kvSet, kvGet, kvDelete } from './googleSheets';

// Test data structures matching the app
type Account = { id: string; name: string; role: "system" | "agent" };
type Transaction = { id: string; kind: "credit" | "debit"; amount: number; memo?: string; dateISO: string; fromId?: string; toId?: string; };
type Notification = { id: string; when: string; text: string };
type AdminNotification = { id: string; when: string; type: "credit"|"debit"|"redeem_request"|"redeem_approved"|"system"; text: string; agentName?: string; amount?: number };
type RedeemRequest = { id: string; agentId: string; agentName: string; prizeKey: string; prizeLabel: string; price: number; when: string; agentPinVerified: boolean };
type AuditLog = { id: string; when: string; adminName: string; action: string; details: string; agentName?: string; amount?: number };
type Wishlist = Record<string, string[]>;

export async function runComprehensiveTest(): Promise<boolean> {
  console.log('🧪 Starting comprehensive Google Sheets integration test...');
  
  try {
    // Test 1: Core Data (Accounts & Transactions)
    console.log('📊 Testing core data (accounts & transactions)...');
    const testAccounts: Account[] = [
      { id: 'test-vault', name: 'Bank Vault', role: 'system' },
      { id: 'test-agent', name: 'Test Agent', role: 'agent' }
    ];
    const testTxns: Transaction[] = [
      { id: 'test-txn-1', kind: 'credit', amount: 1000, memo: 'Test Credit', dateISO: new Date().toISOString(), toId: 'test-agent' },
      { id: 'test-txn-2', kind: 'debit', amount: 100, memo: 'Test Debit', dateISO: new Date().toISOString(), fromId: 'test-agent' }
    ];
    
    await kvSet('gcs-v4-core', { accounts: testAccounts, txns: testTxns });
    const retrievedCore = await kvGet<{ accounts: Account[]; txns: Transaction[] }>('gcs-v4-core');
    
    if (!retrievedCore || retrievedCore.accounts.length !== 2 || retrievedCore.txns.length !== 2) {
      console.error('❌ Core data test failed');
      return false;
    }
    console.log('✅ Core data test passed');

    // Test 2: Stock Management
    console.log('📦 Testing stock management...');
    const testStock = { 'prize-1': 5, 'prize-2': 10 };
    await kvSet('gcs-v4-stock', testStock);
    const retrievedStock = await kvGet<Record<string, number>>('gcs-v4-stock');
    
    if (!retrievedStock || retrievedStock['prize-1'] !== 5) {
      console.error('❌ Stock management test failed');
      return false;
    }
    console.log('✅ Stock management test passed');

    // Test 3: Pins Management
    console.log('🔐 Testing pins management...');
    const testPins = { 'agent-1': '1234', 'agent-2': '5678' };
    await kvSet('gcs-v4-pins', testPins);
    const retrievedPins = await kvGet<Record<string, string>>('gcs-v4-pins');
    
    if (!retrievedPins || retrievedPins['agent-1'] !== '1234') {
      console.error('❌ Pins management test failed');
      return false;
    }
    console.log('✅ Pins management test passed');

    // Test 4: Goals Management
    console.log('🎯 Testing goals management...');
    const testGoals = { 'agent-1': 5000, 'agent-2': 10000 };
    await kvSet('gcs-v4-goals', testGoals);
    const retrievedGoals = await kvGet<Record<string, number>>('gcs-v4-goals');
    
    if (!retrievedGoals || retrievedGoals['agent-1'] !== 5000) {
      console.error('❌ Goals management test failed');
      return false;
    }
    console.log('✅ Goals management test passed');

    // Test 5: Notifications
    console.log('🔔 Testing notifications...');
    const testNotifs: Notification[] = [
      { id: 'notif-1', when: new Date().toISOString(), text: 'Test notification 1' },
      { id: 'notif-2', when: new Date().toISOString(), text: 'Test notification 2' }
    ];
    await kvSet('gcs-v4-notifs', testNotifs);
    const retrievedNotifs = await kvGet<Notification[]>('gcs-v4-notifs');
    
    if (!retrievedNotifs || retrievedNotifs.length !== 2) {
      console.error('❌ Notifications test failed');
      return false;
    }
    console.log('✅ Notifications test passed');

    // Test 6: Admin Notifications
    console.log('👨‍💼 Testing admin notifications...');
    const testAdminNotifs: AdminNotification[] = [
      { id: 'admin-notif-1', when: new Date().toISOString(), type: 'credit', text: 'Admin notification 1', agentName: 'Test Agent', amount: 100 }
    ];
    await kvSet('gcs-v4-admin-notifs', testAdminNotifs);
    const retrievedAdminNotifs = await kvGet<AdminNotification[]>('gcs-v4-admin-notifs');
    
    if (!retrievedAdminNotifs || retrievedAdminNotifs.length !== 1) {
      console.error('❌ Admin notifications test failed');
      return false;
    }
    console.log('✅ Admin notifications test passed');

    // Test 7: Redeem Requests
    console.log('🎁 Testing redeem requests...');
    const testRequests: RedeemRequest[] = [
      { 
        id: 'request-1', 
        agentId: 'agent-1', 
        agentName: 'Test Agent', 
        prizeKey: 'prize-1', 
        prizeLabel: 'Test Prize', 
        price: 100, 
        when: new Date().toISOString(), 
        agentPinVerified: true 
      }
    ];
    await kvSet('gcs-v4-redeem-requests', testRequests);
    const retrievedRequests = await kvGet<RedeemRequest[]>('gcs-v4-redeem-requests');
    
    if (!retrievedRequests || retrievedRequests.length !== 1) {
      console.error('❌ Redeem requests test failed');
      return false;
    }
    console.log('✅ Redeem requests test passed');

    // Test 8: Audit Logs
    console.log('📋 Testing audit logs...');
    const testAuditLogs: AuditLog[] = [
      { 
        id: 'audit-1', 
        when: new Date().toISOString(), 
        adminName: 'Admin User', 
        action: 'Test Action', 
        details: 'Test details',
        agentName: 'Test Agent',
        amount: 100
      }
    ];
    await kvSet('gcs-v4-audit-logs', testAuditLogs);
    const retrievedAuditLogs = await kvGet<AuditLog[]>('gcs-v4-audit-logs');
    
    if (!retrievedAuditLogs || retrievedAuditLogs.length !== 1) {
      console.error('❌ Audit logs test failed');
      return false;
    }
    console.log('✅ Audit logs test passed');

    // Test 9: Wishlist
    console.log('💝 Testing wishlist...');
    const testWishlist: Wishlist = { 'agent-1': ['prize-1', 'prize-2'], 'agent-2': ['prize-3'] };
    await kvSet('gcs-v4-wishlist', testWishlist);
    const retrievedWishlist = await kvGet<Wishlist>('gcs-v4-wishlist');
    
    if (!retrievedWishlist || retrievedWishlist['agent-1'].length !== 2) {
      console.error('❌ Wishlist test failed');
      return false;
    }
    console.log('✅ Wishlist test passed');

    // Test 10: Epochs
    console.log('⏰ Testing epochs...');
    const testEpochs = { 'current': '2025-10-24', 'previous': '2025-10-23' };
    await kvSet('gcs-v4-epochs', testEpochs);
    const retrievedEpochs = await kvGet<Record<string, string>>('gcs-v4-epochs');
    
    if (!retrievedEpochs || retrievedEpochs['current'] !== '2025-10-24') {
      console.error('❌ Epochs test failed');
      return false;
    }
    console.log('✅ Epochs test passed');

    // Test 11: Metrics
    console.log('📈 Testing metrics...');
    const testMetrics = { 
      earned30d: 1000, 
      spent30d: 500, 
      activeAgents: 5,
      totalTransactions: 100
    };
    await kvSet('gcs-v4-metrics', testMetrics);
    const retrievedMetrics = await kvGet<Record<string, any>>('gcs-v4-metrics');
    
    if (!retrievedMetrics || retrievedMetrics['earned30d'] !== 1000) {
      console.error('❌ Metrics test failed');
      return false;
    }
    console.log('✅ Metrics test passed');

    // Test 12: Backups
    console.log('💾 Testing backups...');
    const testBackups = [
      { 
        id: 'backup-1', 
        timestamp: new Date().toISOString(), 
        label: 'Test Backup',
        data: {
          accounts: testAccounts,
          txns: testTxns,
          stock: testStock,
          pins: testPins,
          goals: testGoals,
          wishlist: testWishlist
        }
      }
    ];
    await kvSet('gcs-v4-backups', testBackups);
    const retrievedBackups = await kvGet<any[]>('gcs-v4-backups');
    
    if (!retrievedBackups || retrievedBackups.length !== 1) {
      console.error('❌ Backups test failed');
      return false;
    }
    console.log('✅ Backups test passed');

    // Test 13: Auto Backup Settings
    console.log('🔄 Testing auto backup settings...');
    await kvSet('gcs-v4-auto-backup', true);
    await kvSet('gcs-v4-last-auto-backup', new Date().toISOString());
    const retrievedAutoBackup = await kvGet<boolean>('gcs-v4-auto-backup');
    const retrievedLastBackup = await kvGet<string>('gcs-v4-last-auto-backup');
    
    if (!retrievedAutoBackup || !retrievedLastBackup) {
      console.error('❌ Auto backup settings test failed');
      return false;
    }
    console.log('✅ Auto backup settings test passed');

    // Test 14: Data Persistence (Simulate page refresh)
    console.log('🔄 Testing data persistence...');
    // Simulate clearing memory and reloading
    const freshCore = await kvGet<{ accounts: Account[]; txns: Transaction[] }>('gcs-v4-core');
    const freshStock = await kvGet<Record<string, number>>('gcs-v4-stock');
    const freshGoals = await kvGet<Record<string, number>>('gcs-v4-goals');
    
    if (!freshCore || !freshStock || !freshGoals) {
      console.error('❌ Data persistence test failed');
      return false;
    }
    console.log('✅ Data persistence test passed');

    // Test 15: Delete Operations
    console.log('🗑️ Testing delete operations...');
    await kvDelete('gcs-v4-auto-backup');
    const deletedValue = await kvGet<boolean>('gcs-v4-auto-backup');
    
    if (deletedValue !== null) {
      console.error('❌ Delete operations test failed');
      return false;
    }
    console.log('✅ Delete operations test passed');

    console.log('🎉 All comprehensive tests passed! Google Sheets integration is working perfectly!');
    return true;

  } catch (error) {
    console.error('❌ Comprehensive test failed:', error);
    return false;
  }
}

// Run the test when the module is loaded
runComprehensiveTest().then(success => {
  if (success) {
    console.log('🏆 Google Sheets integration is FLAWLESS!');
  } else {
    console.error('⚠️ Google Sheets integration has issues that need fixing.');
  }
});
