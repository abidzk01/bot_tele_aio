import pino from 'pino';
import { resolve } from 'path';
import { mkdirSync, existsSync, createWriteStream } from 'fs';

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FILE = process.env.LOG_FILE || resolve('./logs/bot.log');
const LOG_DIR = resolve('./logs');
const IS_DEV = process.env.NODE_ENV !== 'production';

if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

const fileStream = createWriteStream(LOG_FILE, { flags: 'a' });

// Custom formatter for development: human-readable
function devFormat(logObj) {
  const time = new Date(logObj.time).toLocaleTimeString('id-ID', { hour12: false });
  const level = logObj.level;
  const module = logObj.module || '';
  const msg = logObj.msg || '';
  const meta = { ...logObj };
  delete meta.level;
  delete meta.time;
  delete meta.service;
  delete meta.version;
  delete meta.module;
  delete meta.msg;
  delete meta.hostname;
  delete meta.pid;
  
  let metaStr = '';
  if (Object.keys(meta).length > 0) {
    metaStr = ' ' + JSON.stringify(meta);
  }
  
  return `[${time}] [${level}] ${module ? `[${module}] ` : ''}${msg}${metaStr}\n`;
}

// Custom write function that outputs pretty to console and JSON to file
const customWrite = (str) => {
  try {
    const logObj = JSON.parse(str);
    // Write pretty to console
    if (IS_DEV) {
      process.stdout.write(devFormat(logObj));
    } else {
      process.stdout.write(str);
    }
    // Always write JSON to file
    fileStream.write(str);
  } catch (e) {
    // Fallback: write raw
    process.stdout.write(str);
    fileStream.write(str);
  }
};

const logger = pino({
  level: LOG_LEVEL,
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  base: {
    service: 'telegram-bot',
    version: process.env.BOT_VERSION || '1.0.0',
  },
}, {
  write: customWrite
});

const moduleLoggers = new Map();

export function createLogger(moduleName, bindings = {}) {
  const key = `${moduleName}:${JSON.stringify(bindings)}`;
  
  if (moduleLoggers.has(key)) {
    return moduleLoggers.get(key);
  }
  
  const childLogger = logger.child({ module: moduleName, ...bindings });
  moduleLoggers.set(key, childLogger);
  return childLogger;
}

export function getLogger() {
  return logger;
}

export function setLogLevel(level) {
  logger.level = level;
  logger.info({ newLevel: level }, 'Log level changed');
}

export const LogLevels = {
  TRACE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
  FATAL: 'fatal',
};

export default {
  createLogger,
  getLogger,
  setLogLevel,
  LogLevels,
};