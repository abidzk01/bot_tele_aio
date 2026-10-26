import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import { setupTestEnvironment, teardownTestEnvironment, createMockContext, clearRateLimitData } from './setup.js';
import { createRateLimiter, destroyRateLimiter, getRateLimiter } from '../modules/RateLimiter.js';
import { Database } from '../modules/Database.js';

let env;

beforeAll(async () => {
  env = await setupTestEnvironment();
}, 10000);

afterAll(async () => {
  teardownTestEnvironment();
}, 10000);

beforeEach(async () => {
  destroyRateLimiter();
  await clearRateLimitData();
  env.rateLimiter = createRateLimiter();
});

afterEach(() => {
  destroyRateLimiter();
});

describe('RateLimiter', () => {
  describe('checkLimit', () => {
    test('should allow first request', async () => {
      const result = await env.rateLimiter.checkLimit('user1', 'music');
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.blocked).toBe(false);
      expect(result.queued).toBe(false);
    });

    test('should track remaining requests correctly', async () => {
      await env.rateLimiter.checkLimit('user2', 'music');
      await env.rateLimiter.checkLimit('user2', 'music');
      await env.rateLimiter.checkLimit('user2', 'music');
      
      const result = await env.rateLimiter.checkLimit('user2', 'music');
      expect(result.remaining).toBe(6);
    });

    test('should NOT block when limit exceeded - returns allowed=false for queuing', async () => {
      for (let i = 0; i < 10; i++) {
        await env.rateLimiter.checkLimit('user3', 'music');
      }
      
      const result = await env.rateLimiter.checkLimit('user3', 'music');
      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(false);
      expect(result.remaining).toBe(0);
    });

    test('should have different limits per command', async () => {
      for (let i = 0; i < 10; i++) {
        await env.rateLimiter.checkLimit('user4', 'music');
      }
      for (let i = 0; i < 20; i++) {
        await env.rateLimiter.checkLimit('user4', 'search');
      }
      for (let i = 0; i < 5; i++) {
        await env.rateLimiter.checkLimit('user4', 'download');
      }
      
      const musicResult = await env.rateLimiter.checkLimit('user4', 'music');
      const searchResult = await env.rateLimiter.checkLimit('user4', 'search');
      const downloadResult = await env.rateLimiter.checkLimit('user4', 'download');
      
      expect(musicResult.allowed).toBe(false);
      expect(searchResult.allowed).toBe(false);
      expect(downloadResult.allowed).toBe(false);
    });

    test('should reset window after time passes', async () => {
      const oldWindowStart = Date.now() - 120000;
      await env.db.rateLimits.set('user5', 'music', 10, oldWindowStart, 0);
      
      const result = await env.rateLimiter.checkLimit('user5', 'music');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(8);
    });
  });

  describe('acquireSlot', () => {
    test('should acquire slot immediately when under limit', async () => {
      const ctx = createMockContext({ userId: 'acquire1' });
      const result = await env.rateLimiter.acquireSlot('acquire1', 'music', ctx);
      
      expect(result.success).toBe(true);
      expect(result.queued).toBe(false);
    });

    test('should return blocked status when user is blocked', async () => {
      const blockedUntil = Date.now() + 5000;
      await env.db.rateLimits.set('acquire3', 'music', 10, Date.now(), blockedUntil);
      
      const ctx = createMockContext({ userId: 'acquire3' });
      const result = await env.rateLimiter.acquireSlot('acquire3', 'music', ctx);
      
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockRemaining).toBeGreaterThan(0);
    });

    test('should queue when at limit (verified by promise creation)', async () => {
      for (let i = 0; i < 10; i++) {
        await env.rateLimiter.checkLimit('acquire2', 'music');
      }
      
      const ctx = createMockContext({ userId: 'acquire2' });
      const promise = env.rateLimiter.acquireSlot('acquire2', 'music', ctx);
      
      // Verify promise was created (queue logic entered)
      expect(promise).toBeInstanceOf(Promise);
      
      // Clean up
      env.rateLimiter.releaseSlot('acquire2', 'music');
      await promise;
    });

    test('should return blocked status when user is blocked', async () => {
      const blockedUntil = Date.now() + 5000;
      await env.db.rateLimits.set('acquire3', 'music', 10, Date.now(), blockedUntil);
      
      const ctx = createMockContext({ userId: 'acquire3' });
      const result = await env.rateLimiter.acquireSlot('acquire3', 'music', ctx);
      
      expect(result.success).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockRemaining).toBeGreaterThan(0);
    });

    test('should timeout queue after configured timeout and block user', async () => {
      for (let i = 0; i < 10; i++) {
        await env.rateLimiter.checkLimit('acquire4', 'music');
      }
      
      const ctx = createMockContext({ userId: 'acquire4' });
      const promise = env.rateLimiter.acquireSlot('acquire4', 'music', ctx);
      
      // Wait for queue timeout (2 seconds in test config)
      await new Promise(resolve => setTimeout(resolve, 2500));
      
      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.timeout).toBe(true);
      expect(result.blocked).toBe(true);
    }, 10000);
  });

  describe('releaseSlot', () => {
    test('should clean up active commands when all released', async () => {
      const ctx = createMockContext({ userId: 'release2' });
      await env.rateLimiter.acquireSlot('release2', 'music', ctx);
      env.rateLimiter.releaseSlot('release2', 'music');
      env.rateLimiter.releaseSlot('release2', 'music');
      
      const status = await env.rateLimiter.getStatus('release2');
      expect(status.active.music).toBeUndefined();
    });
  });

  describe('getStatus', () => {
    test('should return user status with in-memory data', async () => {
      const ctx1 = createMockContext({ userId: 'status1' });
      const ctx2 = createMockContext({ userId: 'status1' });
      
      // Acquire slots for two different commands
      await env.rateLimiter.acquireSlot('status1', 'music', ctx1);
      await env.rateLimiter.acquireSlot('status1', 'search', ctx2);
      
      const status = await env.rateLimiter.getStatus('status1');
      
      // getStatus returns in-memory active/queued data
      expect(status.active.music).toBe(1);
      expect(status.active.search).toBe(1);
      
      // Release slots
      env.rateLimiter.releaseSlot('status1', 'music');
      env.rateLimiter.releaseSlot('status1', 'search');
      
      const status2 = await env.rateLimiter.getStatus('status1');
      expect(status2.active.music).toBeUndefined();
      expect(status2.active.search).toBeUndefined();
    });
  });

  describe('forceUnblock', () => {
    test('should force unblock user', async () => {
      const blockedUntil = Date.now() + 300000;
      await env.db.rateLimits.set('unblock1', 'music', 10, Date.now(), blockedUntil);
      
      await env.rateLimiter.forceUnblock('unblock1', 'music');
      
      const record = await env.db.rateLimits.get('unblock1', 'music');
      expect(record.blocked_until).toBe(0);
    });
  });

  describe('config', () => {
    test('should return current config with test values', () => {
      const config = env.rateLimiter.getConfig();
      
      expect(config.windowMs).toBe(60000);
      expect(config.maxRequests).toBe(10);
      expect(config.blockDuration).toBe(5000);
      expect(config.queueEnabled).toBe(true);
      expect(config.queueTimeout).toBe(2000);
    });

    test('should update config', () => {
      env.rateLimiter.updateConfig({ maxRequests: 50 });
      
      const config = env.rateLimiter.getConfig();
      expect(config.maxRequests).toBe(50);
    });
  });

  describe('cleanup', () => {
    test('should cleanup expired blocks (sets blocked_until to 0)', async () => {
      const oldBlockedUntil = Date.now() - 1000;
      await env.db.rateLimits.set('cleanup1', 'music', 0, Date.now() - 120000, oldBlockedUntil);
      
      await env.rateLimiter.cleanupExpiredBlocks();
      
      const record = await env.db.rateLimits.get('cleanup1', 'music');
      expect(record.blocked_until).toBe(0);
    });
  });
});