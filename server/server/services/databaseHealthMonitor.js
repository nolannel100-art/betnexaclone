/**
 * Database Health Monitor Service
 * Tracks connection pool, query performance, and system health
 * Prevents cascading failures from database exhaustion
 */

const supabase = require('./database');

class DatabaseHealthMonitor {
  constructor() {
    this.metrics = {
      totalQueries: 0,
      failedQueries: 0,
      slowQueries: 0,
      averageQueryTime: 0,
      activeConnections: 0,
      lastHealthCheck: null,
      consecutiveFailures: 0,
      dbUptime: 0,
      startTime: Date.now(),
    };
    
    this.thresholds = {
      maxConnections: 8, // Out of 10
      slowQueryMs: 5000,
      maxConsecutiveFailures: 3,
      checkInterval: 60000, // 60 seconds
    };
    
    this.alerts = [];
    this.startMonitoring();
  }

  startMonitoring() {
    console.log('📊 Starting Database Health Monitor...');
    
    // Check database health every 60 seconds
    this.healthCheckInterval = setInterval(() => {
      this.checkDatabaseHealth();
    }, this.thresholds.checkInterval);
    
    // Log metrics every 5 minutes
    this.metricsInterval = setInterval(() => {
      this.logMetrics();
    }, 300000);
  }

  async checkDatabaseHealth() {
    try {
      const startTime = Date.now();
      
      // Test query - simple and fast
      const { data, error } = await supabase
        .from('users')
        .select('count(*)', { count: 'exact', head: true })
        .timeout(5000);
      
      const duration = Date.now() - startTime;
      this.recordQueryMetric(duration, !error);
      
      if (error) {
        this.metrics.failedQueries++;
        this.metrics.consecutiveFailures++;
        this.addAlert('error', `Database health check failed: ${error.message}`);
        
        // Critical alert if multiple failures
        if (this.metrics.consecutiveFailures >= this.thresholds.maxConsecutiveFailures) {
          this.addAlert('critical', `🚨 Database failing consistently! (${this.metrics.consecutiveFailures} failures)`);
          this.notifyOfCriticalFailure();
        }
      } else {
        this.metrics.consecutiveFailures = 0;
        this.metrics.lastHealthCheck = new Date();
        
        // Check for high connection count
        if (data && Array.isArray(data) && data[0]?.count) {
          this.metrics.activeConnections = data[0].count;
          
          if (this.metrics.activeConnections >= this.thresholds.maxConnections) {
            this.addAlert('warning', `⚠️  Connection pool near capacity: ${this.metrics.activeConnections}/10`);
          }
        }
      }
    } catch (err) {
      this.metrics.failedQueries++;
      this.metrics.consecutiveFailures++;
      this.addAlert('error', `Health check exception: ${err.message}`);
    }
  }

  recordQueryMetric(duration, success) {
    this.metrics.totalQueries++;
    
    if (duration > this.thresholds.slowQueryMs) {
      this.metrics.slowQueries++;
      this.addAlert('warning', `Slow query detected: ${duration}ms`);
    }
    
    // Calculate moving average
    const prevTotal = this.metrics.averageQueryTime * (this.metrics.totalQueries - 1);
    this.metrics.averageQueryTime = (prevTotal + duration) / this.metrics.totalQueries;
  }

  addAlert(level, message) {
    const alert = {
      level,
      message,
      timestamp: new Date(),
      id: `${level}-${Date.now()}`,
    };
    
    this.alerts.push(alert);
    
    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }
    
    // Log critical alerts immediately
    if (level === 'critical') {
      console.error(`🚨 CRITICAL: ${message}`);
    } else if (level === 'error') {
      console.error(`❌ ERROR: ${message}`);
    } else if (level === 'warning') {
      console.warn(`⚠️  WARNING: ${message}`);
    }
  }

  notifyOfCriticalFailure() {
    // In production, you could send alerts via email, Slack, etc.
    console.error('═'.repeat(60));
    console.error('🚨 DATABASE CRITICAL FAILURE DETECTED');
    console.error('═'.repeat(60));
    console.error('Consecutive failures:', this.metrics.consecutiveFailures);
    console.error('Failed queries:', this.metrics.failedQueries);
    console.error('Action: Check Supabase dashboard immediately');
    console.error('URL: https://app.supabase.com/project/skygridtec06');
    console.error('═'.repeat(60));
  }

  logMetrics() {
    const uptime = Math.floor((Date.now() - this.metrics.startTime) / 1000);
    const failureRate = this.metrics.failedQueries / Math.max(this.metrics.totalQueries, 1);
    
    console.log('\n📊 DATABASE METRICS SUMMARY:');
    console.log('─'.repeat(60));
    console.log(`Total Queries: ${this.metrics.totalQueries}`);
    console.log(`Failed Queries: ${this.metrics.failedQueries} (${(failureRate * 100).toFixed(2)}%)`);
    console.log(`Slow Queries (>5s): ${this.metrics.slowQueries}`);
    console.log(`Average Query Time: ${this.metrics.averageQueryTime.toFixed(0)}ms`);
    console.log(`Active Connections: ${this.metrics.activeConnections}/10`);
    console.log(`Last Health Check: ${this.metrics.lastHealthCheck || 'Never'}`);
    console.log(`Uptime: ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`);
    
    if (this.alerts.length > 0) {
      console.log(`\nRecent Alerts: ${this.alerts.length}`);
      this.alerts.slice(-5).forEach(alert => {
        const icon = alert.level === 'critical' ? '🚨' : alert.level === 'error' ? '❌' : '⚠️ ';
        console.log(`  ${icon} [${alert.timestamp.toISOString()}] ${alert.message}`);
      });
    }
    console.log('─'.repeat(60) + '\n');
  }

  getStatus() {
    return {
      healthy: this.metrics.consecutiveFailures < this.thresholds.maxConsecutiveFailures,
      metrics: this.metrics,
      recentAlerts: this.alerts.slice(-10),
    };
  }

  // API endpoint response - include health status
  getHealthResponse() {
    return {
      status: this.metrics.consecutiveFailures < 2 ? 'healthy' : 'unhealthy',
      database: {
        queryCount: this.metrics.totalQueries,
        failureRate: (this.metrics.failedQueries / Math.max(this.metrics.totalQueries, 1) * 100).toFixed(2) + '%',
        avgQueryTime: this.metrics.averageQueryTime.toFixed(0) + 'ms',
        connections: `${this.metrics.activeConnections}/10`,
      },
      timestamp: new Date().toISOString(),
    };
  }

  stopMonitoring() {
    clearInterval(this.healthCheckInterval);
    clearInterval(this.metricsInterval);
    console.log('❌ Database Health Monitor stopped');
  }
}

// Create singleton instance
const monitor = new DatabaseHealthMonitor();

module.exports = monitor;
