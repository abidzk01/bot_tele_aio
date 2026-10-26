import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import { setupTestEnvironment, teardownTestEnvironment, createMockBot } from './setup.js';
import { ModuleLoader } from '../modules/ModuleLoader.js';
import { createLogger } from '../modules/Logger.js';
import { createRateLimiter } from '../modules/RateLimiter.js';
import { Database } from '../modules/Database.js';

let env;
let mockBot;
let moduleLoader;

beforeAll(async () => {
  env = await setupTestEnvironment();
}, 15000);

afterAll(async () => {
  teardownTestEnvironment();
}, 10000);

beforeEach(() => {
  mockBot = createMockBot();
  // Make setMyCommands a jest mock
  mockBot.telegram.setMyCommands = jest.fn().mockResolvedValue(true);
  
  const config = {
    botToken: 'test',
    botName: 'Test Bot',
    botVersion: '1.0.0',
    authorName: 'Test',
    authorEmail: 'test@test.com',
    adminIds: ['123456789'],
    logger: createLogger('TestModuleLoader'),
    db: Database,
    rateLimiter: createRateLimiter(),
  };
  
  moduleLoader = new ModuleLoader(mockBot, config);
});

afterEach(async () => {
  // Cleanup any loaded modules
  for (const [name, module] of moduleLoader.modules) {
    // No cleanup needed for test modules
  }
  moduleLoader.modules.clear();
  moduleLoader.allCommands = [];
});

describe('ModuleLoader', () => {
  test('should create instance', () => {
    expect(moduleLoader).toBeInstanceOf(ModuleLoader);
    expect(moduleLoader.modules).toBeInstanceOf(Map);
    expect(moduleLoader.allCommands).toEqual([]);
  });

  test('should load modules from directory', async () => {
    // This test will load actual modules from the modules directory
    // We'll test with a subset
    const modules = await moduleLoader.loadModules();
    
    expect(modules.size).toBeGreaterThan(0);
    expect(moduleLoader.allCommands.length).toBeGreaterThan(0);
  }, 15000);

  test('should get module by name', async () => {
    await moduleLoader.loadModules();
    
    const musicModule = moduleLoader.getModule('music');
    expect(musicModule).toBeDefined();
    expect(musicModule.name).toBe('music');
    
    const startModule = moduleLoader.getModule('start');
    expect(startModule).toBeDefined();
    expect(startModule.name).toBe('start');
  }, 15000);

  test('should return undefined for non-existent module', async () => {
    await moduleLoader.loadModules();
    
    const module = moduleLoader.getModule('nonexistent');
    expect(module).toBeUndefined();
  }, 15000);

  test('should get all modules', async () => {
    await moduleLoader.loadModules();
    
    const modules = moduleLoader.getAllModules();
    expect(Array.isArray(modules)).toBe(true);
    expect(modules.length).toBe(moduleLoader.modules.size);
  }, 15000);

  test('should collect commands from modules', async () => {
    await moduleLoader.loadModules();
    
    const commands = moduleLoader.allCommands;
    expect(commands.length).toBeGreaterThan(0);
    
    // Check that commands have required properties
    for (const cmd of commands) {
      expect(cmd.command).toBeDefined();
      expect(cmd.description).toBeDefined();
      expect(typeof cmd.adminOnly).toBe('boolean');
      expect(cmd.module).toBeDefined();
    }
  }, 15000);

  test('should register slash commands to Telegram', async () => {
    await moduleLoader.loadModules();
    
    // Verify setMyCommands was called
    expect(mockBot.telegram.setMyCommands).toHaveBeenCalled();
    
    const commands = mockBot.telegram.setMyCommands.mock.calls[0][0];
    expect(Array.isArray(commands)).toBe(true);
    expect(commands.length).toBeGreaterThan(0);
    
    for (const cmd of commands) {
      expect(cmd.command).toBeDefined();
      expect(cmd.description).toBeDefined();
    }
  }, 15000);
});