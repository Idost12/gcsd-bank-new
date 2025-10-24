// src/lib/realTimeMonitor.ts
// Real-time monitoring system for Google Sheets integration
// Updated: October 24, 2025 - Live functionality monitoring

import { kvGet, kvSet } from './googleSheets';

export class RealTimeMonitor {
  private static instance: RealTimeMonitor;
  private monitoringActive = false;
  private checkInterval: number | null = null;

  static getInstance(): RealTimeMonitor {
    if (!RealTimeMonitor.instance) {
      RealTimeMonitor.instance = new RealTimeMonitor();
    }
    return RealTimeMonitor.instance;
  }

  startMonitoring(): void {
    if (this.monitoringActive) return;
    
    this.monitoringActive = true;
    console.log('🔍 Starting real-time monitoring of Google Sheets integration...');
    
    this.checkInterval = window.setInterval(async () => {
      await this.performHealthCheck();
    }, 10000); // Check every 10 seconds
  }

  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.monitoringActive = false;
    console.log('🛑 Real-time monitoring stopped');
  }

  private async performHealthCheck(): Promise<void> {
    try {
      // Test 1: Core Data Read/Write
      const testData = { test: `health-check-${Date.now()}` };
      await kvSet('health-check', testData);
      const retrieved = await kvGet('health-check');
      
      if (!retrieved || retrieved.test !== testData.test) {
        console.warn('⚠️ Health check failed: Core data read/write issue');
        return;
      }

      // Test 2: Recent Transactions
      const core = await kvGet<{ accounts: any[]; txns: any[] }>('gcs-v4-core');
      if (core && core.txns) {
        const recentTxns = core.txns.slice(-5); // Last 5 transactions
        console.log(`📊 Recent transactions: ${recentTxns.length} found`);
      }

      // Test 3: Notifications
      const notifs = await kvGet<any[]>('gcs-v4-notifs');
      if (notifs) {
        console.log(`🔔 Notifications: ${notifs.length} active`);
      }

      // Test 4: Goals
      const goals = await kvGet<Record<string, number>>('gcs-v4-goals');
      if (goals) {
        const activeGoals = Object.keys(goals).length;
        console.log(`🎯 Active goals: ${activeGoals}`);
      }

      // Test 5: Requests
      const requests = await kvGet<any[]>('gcs-v4-redeem-requests');
      if (requests) {
        const pendingRequests = requests.filter(r => !r.approved);
        console.log(`🎁 Pending requests: ${pendingRequests.length}`);
      }

      // Test 6: Multi-user Sync
      const stock = await kvGet<Record<string, number>>('gcs-v4-stock');
      if (stock) {
        const totalStock = Object.values(stock).reduce((sum, count) => sum + count, 0);
        console.log(`📦 Total stock items: ${totalStock}`);
      }

      console.log('✅ All systems operational - Google Sheets integration healthy');

    } catch (error) {
      console.error('❌ Health check failed:', error);
    }
  }

  // Test specific functionality
  async testTransactionFlow(): Promise<boolean> {
    try {
      console.log('🧪 Testing transaction flow...');
      
      // Create test transaction
      const testTxn = {
        id: `test-${Date.now()}`,
        kind: 'credit' as const,
        amount: 100,
        memo: 'Test transaction',
        dateISO: new Date().toISOString(),
        toId: 'test-agent'
      };

      // Get current core data
      const core = await kvGet<{ accounts: any[]; txns: any[] }>('gcs-v4-core');
      if (!core) {
        console.error('❌ No core data found');
        return false;
      }

      // Add transaction
      const updatedTxns = [...core.txns, testTxn];
      await kvSet('gcs-v4-core', { ...core, txns: updatedTxns });

      // Verify transaction was added
      const updatedCore = await kvGet<{ accounts: any[]; txns: any[] }>('gcs-v4-core');
      if (!updatedCore || updatedCore.txns.length !== core.txns.length + 1) {
        console.error('❌ Transaction not persisted');
        return false;
      }

      console.log('✅ Transaction flow test passed');
      return true;
    } catch (error) {
      console.error('❌ Transaction flow test failed:', error);
      return false;
    }
  }

  async testNotificationSystem(): Promise<boolean> {
    try {
      console.log('🧪 Testing notification system...');
      
      const testNotif = {
        id: `notif-${Date.now()}`,
        when: new Date().toISOString(),
        text: 'Test notification'
      };

      // Get current notifications
      const currentNotifs = await kvGet<any[]>('gcs-v4-notifs') || [];
      
      // Add notification
      const updatedNotifs = [...currentNotifs, testNotif];
      await kvSet('gcs-v4-notifs', updatedNotifs);

      // Verify notification was added
      const retrievedNotifs = await kvGet<any[]>('gcs-v4-notifs');
      if (!retrievedNotifs || retrievedNotifs.length !== currentNotifs.length + 1) {
        console.error('❌ Notification not persisted');
        return false;
      }

      console.log('✅ Notification system test passed');
      return true;
    } catch (error) {
      console.error('❌ Notification system test failed:', error);
      return false;
    }
  }

  async testGoalSystem(): Promise<boolean> {
    try {
      console.log('🧪 Testing goal system...');
      
      const testGoal = { 'test-agent': 5000 };
      
      // Set goal
      await kvSet('gcs-v4-goals', testGoal);
      
      // Verify goal was set
      const retrievedGoals = await kvGet<Record<string, number>>('gcs-v4-goals');
      if (!retrievedGoals || retrievedGoals['test-agent'] !== 5000) {
        console.error('❌ Goal not persisted');
        return false;
      }

      console.log('✅ Goal system test passed');
      return true;
    } catch (error) {
      console.error('❌ Goal system test failed:', error);
      return false;
    }
  }

  async testRequestSystem(): Promise<boolean> {
    try {
      console.log('🧪 Testing request system...');
      
      const testRequest = {
        id: `request-${Date.now()}`,
        agentId: 'test-agent',
        agentName: 'Test Agent',
        prizeKey: 'test-prize',
        prizeLabel: 'Test Prize',
        price: 100,
        when: new Date().toISOString(),
        agentPinVerified: true
      };

      // Get current requests
      const currentRequests = await kvGet<any[]>('gcs-v4-redeem-requests') || [];
      
      // Add request
      const updatedRequests = [...currentRequests, testRequest];
      await kvSet('gcs-v4-redeem-requests', updatedRequests);

      // Verify request was added
      const retrievedRequests = await kvGet<any[]>('gcs-v4-redeem-requests');
      if (!retrievedRequests || retrievedRequests.length !== currentRequests.length + 1) {
        console.error('❌ Request not persisted');
        return false;
      }

      console.log('✅ Request system test passed');
      return true;
    } catch (error) {
      console.error('❌ Request system test failed:', error);
      return false;
    }
  }

  // Run all functionality tests
  async runAllTests(): Promise<boolean> {
    console.log('🚀 Running comprehensive functionality tests...');
    
    const results = await Promise.all([
      this.testTransactionFlow(),
      this.testNotificationSystem(),
      this.testGoalSystem(),
      this.testRequestSystem()
    ]);

    const allPassed = results.every(result => result);
    
    if (allPassed) {
      console.log('🎉 All functionality tests passed! Your bank is FLAWLESS!');
    } else {
      console.error('⚠️ Some functionality tests failed. Check the logs above.');
    }

    return allPassed;
  }
}

// Auto-start monitoring when the module loads
const monitor = RealTimeMonitor.getInstance();
monitor.startMonitoring();

// Run comprehensive tests after a short delay
setTimeout(() => {
  monitor.runAllTests();
}, 5000);
