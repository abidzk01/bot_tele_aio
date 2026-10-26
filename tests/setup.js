import { Database } from '../modules/Database.js';
import { createLogger, getLogger } from '../modules/Logger.js';
import { createRateLimiter, destroyRateLimiter, getRateLimiter } from '../modules/RateLimiter.js';
import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { mkdirSync, existsSync, rmSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const TEST_DB_PATH = resolve(__dirname, 'test-data', 'test.sqlite');
const TEST_LOG_PATH = resolve(__dirname, 'test-logs', 'test.log');

export async function setupTestEnvironment() {
  const testDataDir = resolve(__dirname, 'test-data');
  const testLogsDir = resolve(__dirname, 'test-logs');
  
  if (!existsSync(testDataDir)) {
    mkdirSync(testDataDir, { recursive: true });
  }
  if (!existsSync(testLogsDir)) {
    mkdirSync(testLogsDir, { recursive: true });
  }
  
  process.env.DB_PATH = TEST_DB_PATH;
  process.env.LOG_FILE = TEST_LOG_PATH;
  process.env.LOG_LEVEL = 'silent';
  process.env.NODE_ENV = 'test';
  process.env.RATE_LIMIT_WINDOW_MS = '60000';
  process.env.RATE_LIMIT_MAX_REQUESTS = '10';
  process.env.RATE_LIMIT_BLOCK_DURATION = '5000';
  process.env.RATE_LIMIT_QUEUE_ENABLED = 'true';
  process.env.RATE_LIMIT_QUEUE_TIMEOUT = '2000';
  
  destroyRateLimiter();
  Database.closeDb();
  
  // Initialize database
  await Database.init();
  
  const logger = createLogger('Test');
  const rateLimiter = createRateLimiter();
  
  return { logger, rateLimiter, db: Database };
}

export async function clearRateLimitData() {
  const db = await Database.getDb();
  db.exec('DELETE FROM rate_limits');
  db.exec('DELETE FROM queue_entries');
}

export function teardownTestEnvironment() {
  destroyRateLimiter();
  Database.closeDb();
  
  const testDataDir = resolve(__dirname, 'test-data');
  const testLogsDir = resolve(__dirname, 'test-logs');
  
  if (existsSync(testDataDir)) {
    rmSync(testDataDir, { recursive: true, force: true });
  }
  if (existsSync(testLogsDir)) {
    rmSync(testLogsDir, { recursive: true, force: true });
  }
}

export function createMockContext(overrides = {}) {
  const userId = overrides.userId || 123456789;
  const chatId = overrides.chatId || 987654321;
  let messageId = overrides.messageId || 1;
  const username = overrides.username || 'testuser';
  const firstName = overrides.firstName || 'Test';
  
  return {
    from: { id: userId, username, first_name: firstName, is_bot: false },
    chat: { id: chatId, type: 'private' },
    message: { 
      message_id: messageId, 
      text: overrides.text || '/test', 
      from: { id: userId, username, first_name: firstName },
      chat: { id: chatId }
    },
    reply: async (text, options) => ({ message_id: ++messageId, text, ...options }),
    editMessageText: async (chatId, msgId, inlineMessageId, text, options) => ({ message_id: msgId, text, ...options }),
    deleteMessage: async (chatId, msgId) => true,
    answerCbQuery: async (text) => true,
    telegram: {
      setMyCommands: async () => true,
      editMessageText: async (chatId, msgId, inlineMessageId, text, options) => ({ message_id: msgId, text, ...options }),
      deleteMessage: async (chatId, msgId) => true,
    },
    botInfo: { username: 'testbot' },
    ...overrides
  };
}

export function createMockBot() {
  const handlers = new Map();
  const commands = new Map();
  
  const mockCommand = (cmd, ...middlewares) => {
    commands.set(cmd, middlewares);
    return mockBot;
  };
  
  const mockBot = {
    command: mockCommand,
    hears: (pattern, ...middlewares) => {
      handlers.set(`hears:${pattern}`, middlewares);
      return mockBot;
    },
    action: (pattern, ...middlewares) => {
      handlers.set(`action:${pattern}`, middlewares);
      return mockBot;
    },
    catch: (handler) => {
      handlers.set('error', handler);
      return mockBot;
    },
    start: (...middlewares) => {
      commands.set('start', middlewares);
      return mockBot;
    },
    help: (...middlewares) => {
      commands.set('help', middlewares);
      return mockBot;
    },
    launch: async () => true,
    stop: async () => true,
    telegram: {
      setMyCommands: async (cmds) => {
        commands.set('slashCommands', cmds);
        return true;
      },
      editMessageText: async () => ({ message_id: 1, text: 'edited' }),
      deleteMessage: async () => true,
    },
    handlers,
    commands
  };
  
  return mockBot;
}

export { createMockBot as mockBot };