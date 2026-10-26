import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import { setupTestEnvironment, teardownTestEnvironment, createMockContext, createMockBot } from './setup.js';
import BaseModule from '../modules/BaseModule.js';
import { createLogger } from '../modules/Logger.js';
import { createRateLimiter } from '../modules/RateLimiter.js';
import { Database } from '../modules/Database.js';

let env;
let mockBot;
let mockContext;

beforeAll(async () => {
  env = await setupTestEnvironment();
  mockBot = createMockBot();
}, 10000);

afterAll(async () => {
  teardownTestEnvironment();
}, 10000);

beforeEach(() => {
  mockContext = createMockContext({ userId: 'testuser' });
});

describe('BaseModule', () => {
  let testModule;
  let config;

  beforeEach(() => {
    config = {
      botToken: 'test',
      botName: 'Test Bot',
      botVersion: '1.0.0',
      authorName: 'Test',
      authorEmail: 'test@test.com',
      adminIds: ['123456789', 'testuser'],
      logger: createLogger('TestBaseModule'),
      db: Database,
      rateLimiter: createRateLimiter(),
    };

    class TestModule extends BaseModule {
      constructor() {
        super();
        this.name = 'testmodule';
        this.description = 'Test module';
        this.version = '1.0.0';
        this.commands = [
          { command: 'testcmd', description: 'Test command', adminOnly: false },
          { command: 'admncmd', description: 'Admin command', adminOnly: true },
        ];
      }

      registerHandlers() {
        this.rateLimitedCommand('testcmd', 'Test command', async (ctx) => {
          await ctx.reply('Test response');
        });

        this.rateLimitedCommand('admncmd', 'Admin command', async (ctx) => {
          await ctx.reply('Admin response');
        }, { adminOnly: true });
      }
    }

    testModule = new TestModule();
  });

  test('should initialize with config', async () => {
    await testModule.init(mockBot, config);
    
    expect(testModule.bot).toBe(mockBot);
    expect(testModule.config).toBe(config);
    expect(testModule.adminIds).toEqual(config.adminIds);
    expect(testModule.logger).toBeDefined();
    expect(testModule.rateLimiter).toBeDefined();
    expect(testModule.db).toBe(Database);
  });

  test('should register commands', async () => {
    await testModule.init(mockBot, config);
    
    // Check that command was called (not a jest mock, so we check differently)
    expect(mockBot.commands.has('testcmd')).toBe(true);
    expect(mockBot.commands.has('admncmd')).toBe(true);
  });

  test('should check admin status', async () => {
    await testModule.init(mockBot, config);
    
    expect(testModule.isAdmin('123456789')).toBe(true);
    expect(testModule.isAdmin('testuser')).toBe(true);
    expect(testModule.isAdmin('999999999')).toBe(false);
  });

  test('should create admin middleware', async () => {
    await testModule.init(mockBot, config);
    
    const middleware = testModule.adminOnlyMiddleware();
    expect(typeof middleware).toBe('function');
  });

  test('should create rate limit middleware', async () => {
    await testModule.init(mockBot, config);
    
    const middleware = testModule.rateLimitMiddleware('testcmd');
    expect(typeof middleware).toBe('function');
  });

  test('should reply with formatted message', async () => {
    await testModule.init(mockBot, config);
    
    const result = await testModule.reply(mockContext, 'Test message');
    expect(result).toBeDefined();
    expect(result.text).toBe('Test message');
    expect(result.parse_mode).toBe('Markdown');
  });

  test('should reply with error', async () => {
    await testModule.init(mockBot, config);
    
    const error = new Error('Test error');
    const result = await testModule.replyError(mockContext, error);
    expect(result).toBeDefined();
    expect(result.text).toContain('Terjadi kesalahan');
  });

  test('should get command definitions', async () => {
    await testModule.init(mockBot, config);
    
    const defs = testModule.getCommandDefinitions();
    expect(defs.length).toBe(2);
    expect(defs[0].command).toBe('testcmd');
    expect(defs[1].command).toBe('admncmd');
  });

  test('should log user action', async () => {
    await testModule.init(mockBot, config);
    
    expect(() => {
      testModule.logUserAction('testuser', 'test_action', { key: 'value' });
    }).not.toThrow();
  });

  describe('rateLimitedCommand', () => {
    test('should register command with rate limiting', async () => {
      await testModule.init(mockBot, config);
      
      // Check that command was registered with middleware
      const testCmd = mockBot.commands.get('testcmd');
      expect(testCmd).toBeDefined();
      // Should have: rateLimitMiddleware, handler
      expect(testCmd.length).toBeGreaterThanOrEqual(2);
    });

    test('should register admin command with admin middleware', async () => {
      await testModule.init(mockBot, config);
      
      const adminCmd = mockBot.commands.get('admncmd');
      expect(adminCmd).toBeDefined();
      // Should have: adminMiddleware, rateLimitMiddleware, handler
      expect(adminCmd.length).toBeGreaterThanOrEqual(3);
    });

    test('should allow disabling rate limit', async () => {
      class NoRateLimitModule extends BaseModule {
        constructor() {
          super();
          this.name = 'noratelimit';
          this.commands = [
            { command: 'nolimit', description: 'No limit', adminOnly: false, rateLimit: false }
          ];
        }
        registerHandlers() {
          this.rateLimitedCommand('nolimit', 'No limit', async (ctx) => {
            await ctx.reply('OK');
          }, { rateLimit: false });
        }
      }

      const noRateModule = new NoRateLimitModule();
      await noRateModule.init(mockBot, config);
      
      const noLimitCall = mockBot.commands.get('nolimit');
      
      expect(noLimitCall).toBeDefined();
      // Should have only: handler (no rate limit middleware)
      expect(noLimitCall.length).toBe(1);
    });
  });
});