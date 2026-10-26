import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { setupTestEnvironment, teardownTestEnvironment } from './setup.js';
import { Database } from '../modules/Database.js';

let env;

beforeAll(async () => {
  env = await setupTestEnvironment();
}, 10000);

afterAll(async () => {
  teardownTestEnvironment();
}, 10000);

beforeEach(async () => {
  await Database.rateLimits.cleanup();
  await Database.users.upsert('testuser', 'testuser', 'Test', 'User', 'en');
});

describe('Database', () => {
  describe('rateLimits', () => {
    test('should set and get rate limit record', async () => {
      const userId = 'user1';
      const command = 'music';
      const windowStart = Date.now();
      
      await Database.rateLimits.set(userId, command, 5, windowStart, 0);
      const record = await Database.rateLimits.get(userId, command);
      
      expect(record).toBeDefined();
      expect(record.user_id).toBe(userId);
      expect(record.command).toBe(command);
      expect(record.count).toBe(5);
      expect(record.window_start).toBe(windowStart);
    });

    test('should increment rate limit count', async () => {
      const userId = 'user2';
      const command = 'search';
      const windowStart = Date.now();
      
      await Database.rateLimits.set(userId, command, 1, windowStart, 0);
      await Database.rateLimits.increment(userId, command);
      
      const record = await Database.rateLimits.get(userId, command);
      expect(record.count).toBe(2);
    });

    test('should reset window', async () => {
      const userId = 'user3';
      const command = 'download';
      const oldWindowStart = Date.now() - 120000;
      
      await Database.rateLimits.set(userId, command, 10, oldWindowStart, 0);
      await Database.rateLimits.resetWindow(userId, command);
      
      const record = await Database.rateLimits.get(userId, command);
      expect(record.count).toBe(1);
      // resetWindow uses strftime('%s', 'now') which is seconds, so window_start will be in seconds
      expect(record.window_start).toBeGreaterThan(Math.floor(Date.now() / 1000) - 2);
    });

    test('should block and unblock user', async () => {
      const userId = 'user4';
      const command = 'music';
      const blockedUntil = Date.now() + 300000;
      
      await Database.rateLimits.set(userId, command, 5, Date.now(), 0);
      await Database.rateLimits.block(userId, command, blockedUntil);
      
      let record = await Database.rateLimits.get(userId, command);
      expect(record.blocked_until).toBe(blockedUntil);
      
      await Database.rateLimits.unblock(userId, command);
      record = await Database.rateLimits.get(userId, command);
      expect(record.blocked_until).toBe(0);
    });

    test('should get all limits for user', async () => {
      const userId = 'user5';
      const windowStart = Date.now();
      
      await Database.rateLimits.set(userId, 'music', 3, windowStart, 0);
      await Database.rateLimits.set(userId, 'search', 5, windowStart, 0);
      await Database.rateLimits.set(userId, 'download', 1, windowStart, 0);
      
      const limits = await Database.rateLimits.getAllForUser(userId);
      expect(limits.length).toBe(3);
    });
  });

  describe('users', () => {
    test('should upsert user', async () => {
      const result = await Database.users.upsert('newuser', 'newuser', 'New', 'User', 'en');
      expect(result.changes).toBeGreaterThan(0);
      
      const user = await Database.users.get('newuser');
      expect(user).toBeDefined();
      expect(user.id).toBe('newuser');
      expect(user.username).toBe('newuser');
      expect(user.first_name).toBe('New');
      expect(user.total_commands).toBe(1);
    });

    test('should increment commands on upsert', async () => {
      await Database.users.upsert('incuser', 'incuser', 'Inc', 'User', 'en');
      await Database.users.upsert('incuser', 'incuser', 'Inc', 'User', 'en');
      await Database.users.upsert('incuser', 'incuser', 'Inc', 'User', 'en');
      
      const user = await Database.users.get('incuser');
      expect(user.total_commands).toBe(3);
    });

    test('should increment downloads', async () => {
      await Database.users.upsert('dluser', 'dluser', 'DL', 'User', 'en');
      await Database.users.incrementDownloads('dluser');
      await Database.users.incrementDownloads('dluser');
      
      const user = await Database.users.get('dluser');
      expect(user.total_downloads).toBe(2);
    });

    test('should ban and unban user', async () => {
      await Database.users.upsert('banuser', 'banuser', 'Ban', 'User', 'en');
      await Database.users.ban('banuser', 'Spamming');
      
      let user = await Database.users.get('banuser');
      expect(user.is_banned).toBe(1);
      expect(user.ban_reason).toBe('Spamming');
      
      await Database.users.unban('banuser');
      user = await Database.users.get('banuser');
      expect(user.is_banned).toBe(0);
      expect(user.ban_reason).toBeNull();
    });

    test('should get users with pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await Database.users.upsert(`pageuser${i}`, `pageuser${i}`, `Page${i}`, 'User', 'en');
      }
      
      const users = await Database.users.getAll(2, 0);
      expect(users.length).toBe(2);
      
      const users2 = await Database.users.getAll(2, 2);
      expect(users2.length).toBe(2);
    });

    test('should count users', async () => {
      const initialCount = (await Database.users.count()).count;
      await Database.users.upsert('countuser1', 'countuser1', 'Count', 'User', 'en');
      await Database.users.upsert('countuser2', 'countuser2', 'Count', 'User', 'en');
      
      expect((await Database.users.count()).count).toBe(initialCount + 2);
    });
  });

  describe('commandStats', () => {
    test('should record command stats', async () => {
      await Database.commandStats.record('testcmd', 150);
      await Database.commandStats.record('testcmd', 200);
      
      const stats = await Database.commandStats.get('testcmd');
      expect(stats.total_calls).toBe(2);
      expect(stats.total_duration_ms).toBe(350);
      expect(stats.avg_duration_ms).toBe(175);
      expect(stats.min_duration_ms).toBe(150);
      expect(stats.max_duration_ms).toBe(200);
    });

    test('should increment errors', async () => {
      await Database.commandStats.record('errorcmd', 100);
      await Database.commandStats.incrementErrors('errorcmd');
      await Database.commandStats.incrementErrors('errorcmd');
      
      const stats = await Database.commandStats.get('errorcmd');
      expect(stats.errors).toBe(2);
    });

    test('should get top commands', async () => {
      // Use unique command names to avoid interference from other tests
      const uniquePrefix = 'topcmd_' + Date.now() + '_';
      await Database.commandStats.record(`${uniquePrefix}1`, 100);
      await Database.commandStats.record(`${uniquePrefix}1`, 100);
      await Database.commandStats.record(`${uniquePrefix}1`, 100);
      await Database.commandStats.record(`${uniquePrefix}2`, 100);
      await Database.commandStats.record(`${uniquePrefix}3`, 100);
      await Database.commandStats.record(`${uniquePrefix}3`, 100);
      
      const top = await Database.commandStats.getTop(10);
      // Filter to only our test commands
      const ourCommands = top.filter(c => c.command.startsWith(uniquePrefix));
      expect(ourCommands.length).toBe(3);
      expect(ourCommands[0].command).toBe(`${uniquePrefix}1`);
      expect(ourCommands[0].total_calls).toBe(3);
      expect(ourCommands[1].command).toBe(`${uniquePrefix}3`);
      expect(ourCommands[1].total_calls).toBe(2);
    });
  });

  describe('downloadHistory', () => {
    test('should insert and update download history', async () => {
      const id = await Database.downloadHistory.insert(
        'user1', 'track1', 'Test Song', 'Test Artist', 'Test Album',
        1024000, 180, 'FLAC', 'queued'
      );
      
      expect(id).toBeDefined();
      
      await Database.downloadHistory.update(id, 'success', 1024000, 180, null);
      
      const history = await Database.downloadHistory.getByUser('user1');
      expect(history.length).toBe(1);
      expect(history[0].status).toBe('success');
      expect(history[0].file_size).toBe(1024000);
    });

    test('should get download stats', async () => {
      await Database.downloadHistory.insert('statsuser', 't1', 'Song 1', 'Artist', 'Album', 1000, 180, 'FLAC', 'success');
      await Database.downloadHistory.insert('statsuser', 't2', 'Song 2', 'Artist', 'Album', 2000, 200, 'FLAC', 'success');
      await Database.downloadHistory.insert('statsuser', 't3', 'Song 3', 'Artist', 'Album', 0, 0, 'FLAC', 'failed');
      
      const stats = await Database.downloadHistory.getStats('statsuser');
      expect(stats.total).toBe(3);
      expect(stats.success).toBe(2);
      expect(stats.failed).toBe(1);
      expect(stats.total_bytes).toBe(3000);
    });
  });

  describe('queueEntries', () => {
    test('should insert and update queue entries', async () => {
      const id = await Database.queueEntries.insert('queueuser', 'music', 1);
      expect(id).toBeDefined();
      
      await Database.queueEntries.updateStatus(id, 'processing');
      let entry = await Database.queueEntries.getById(id);
      expect(entry.status).toBe('processing');
      expect(entry.started_at).toBeDefined();
      
      await Database.queueEntries.updateStatus(id, 'completed');
      entry = await Database.queueEntries.getById(id);
      expect(entry.status).toBe('completed');
      expect(entry.completed_at).toBeDefined();
    });

    test('should get waiting queue entries', async () => {
      await Database.queueEntries.insert('queueuser2', 'music', 1);
      await Database.queueEntries.insert('queueuser2', 'search', 2);
      await Database.queueEntries.insert('queueuser2', 'download', 3);
      
      const waiting = await Database.queueEntries.getWaiting('queueuser2');
      expect(waiting.length).toBe(3);
      expect(waiting[0].position).toBe(1);
      expect(waiting[2].position).toBe(3);
    });
  });

  describe('transactions', () => {
    test('should run transaction', async () => {
      const result = await Database.transaction(async (db) => {
        await Database.users.upsert('txuser1', 'txuser1', 'Tx', 'User', 'en');
        await Database.users.upsert('txuser2', 'txuser2', 'Tx', 'User', 'en');
        return { success: true };
      });
      
      expect(result.success).toBe(true);
      expect(await Database.users.get('txuser1')).toBeDefined();
      expect(await Database.users.get('txuser2')).toBeDefined();
    });
  });
});