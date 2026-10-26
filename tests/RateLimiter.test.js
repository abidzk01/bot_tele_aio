import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import { setupTestEnvironment, teardownTestEnvironment, createMockContext } from './setup.js';
import { createRateLimiter, destroyRateLimiter, getRateLimiter } from '../modules/RateLimiter.js';

let env;

beforeAll(async () => {
  env = await setupTestEnvironment();
}, 10000);

afterAll(async () => {
  teardownTestEnvironment();
}, 10000);

beforeEach(() => {
  destroyRateLimiter();
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
      expect(result.remaining).toBe(8); // limit 10, count becomes 1, remaining = 10 - 1 - 1 = 8
      expect(result.blocked).toBe(false);
      expect(result.queued).toBe(false);
    });

    test('should track remaining requests', async () => {
      await env.rateLimiter.checkLimit('user2', 'music');
      await env.rateLimiter.checkLimit('user2', 'music');
      await env.rateLimiter.checkLimit('user2', 'music');
      
      const result = await env.rateLimiter.checkLimit('user2', 'music');
      expect(result.remaining).toBe(6); // 4 requests used, remaining = 10 - 4 = 6
    });

    test('should block when limit exceeded', async () => {
      // Use up all 10 requests for music
      for (let i = 0; i < 10; i++) {
        await env.rateLimiter.checkLimit('user3', 'music');
      }
      
      const result = await env.rateLimiter.checkLimit('user3', 'music');
      expect(result.allowed).toBe(false);
      expect(result.blocked).toBe(true);
      expect(result.blockRemaining).toBeGreaterThan(0);
    });

    test('should have different limits per command', async () => {
      // music: 10, search: 20, download: 5
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
      // Manually set old window
      const oldWindowStart = Date.now() - 120000;
      await env.db.rateLimits.set('user5', 'music', 10, oldWindowStart, 0);
      
      const result = await env.rateLimiter.checkLimit('user5', 'music');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(8); // reset to count=1, remaining = 10 - 1 - 1 = 8
    });
  });

  describe('acquireSlot', () => {
    test('should acquire slot immediately when under limit', async () => {
      const ctx = createMockContext({ userId: 'acquire1' });
      const result = await env.rateLimiter.acquireSlot('acquire1', 'music', ctx);
      
      expect(result.success).toBe(true);
      expect(result.queued).toBe(false);
    });

    test('should queue when at limit', async () => {
      // Fill up the limit
      for (let i = 0; i < 10; i++) {
        await env.rateLimiter.checkLimit('acquire2', 'music');
      }
      
      const ctx = createMockContext({ userId: 'acquire2' });
      const promise = env.rateLimiter.acquireSlot('acquire2', 'music', ctx);
      
      // Should be queued
      expect(env.rateLimiter.queues.has('acquire2:music')).toBe(true);
      expect(env.rateLimiter.queues.get('acquire2:music').length).toBe(1);
      
      // Release one slot
      env.rateLimiter.releaseSlot('acquire2', 'music');
      
      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.queued).toBe(true);
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

    test('should timeout queue after configured timeout', async () => {
      // Fill up the limit
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
    }, 10000);
  });

  describe('releaseSlot', () => {
    test('should release slot and process queue', async () => {
      // Fill up the limit
      for (let i = 0; i < 10; i++) {
        await env.rateLimiter.checkLimit('release1', 'music');
      }
      
      // Queue a request
      const ctx = createMockContext({ userId: 'release1' });
      const promise = env.rateLimiter.acquireSlot('release1', 'music', ctx);
      
      // Release slot
      env.rateLimiter.releaseSlot('release1', 'music');
      
      const result = await promise;
      expect(result.success).toBe(true);
    });

    test('should clean up active commands when all released', async () => {
      await env.rateLimiter.checkLimit('release2', 'music');
      env.rateLimiter.releaseSlot('release2', 'music');
      env.rateLimiter.releaseSlot('release2', 'music'); // Extra release
      
      const status = env.rateLimiter.getStatus('release2');
      expect(status.active.music).toBeUndefined();
    });
  });

  describe('getStatus', () => {
    test('should return user status', async () => {
      await env.rateLimiter.checkLimit('status1', 'music');
      await env.rateLimiter.checkLimit('status1', 'search');
      
      const status = env.rateLimiter.getStatus('status1');
      
      expect(status.limits.length).toBe(2);
      expect(status.active.music).toBe(1);
      expect(status.active.search).toBe(1);
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
    test('should return current config', () => {
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
    test('should cleanup expired blocks', async () => {
      const oldBlockedUntil = Date.now() - 1000;
      await env.db.rateLimits.set('cleanup1', 'music', 0, Date.now() - 120000, oldBlockedUntil);
      
      env.rateLimiter.cleanupExpiredBlocks();
      
      const record = await env.db.rateLimits.get('cleanup1', 'music');
      expect(record).toBeNull();
    });
  });
});