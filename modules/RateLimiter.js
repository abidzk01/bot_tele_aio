import { Database } from './Database.js';
import { createLogger } from './Logger.js';

const logger = createLogger('RateLimiter');

const DEFAULT_CONFIG = {
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000,
  maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 30,
  blockDuration: parseInt(process.env.RATE_LIMIT_BLOCK_DURATION) || 300000,
  queueEnabled: process.env.RATE_LIMIT_QUEUE_ENABLED !== 'false',
  queueTimeout: parseInt(process.env.RATE_LIMIT_QUEUE_TIMEOUT) || 120000,
  perCommandLimits: {
    music: 10,
    search: 20,
    download: 5,
    system: 10,
  },
};

class RateLimiter {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.activeCommands = new Map();
    this.queues = new Map();
    this.cleanupInterval = null;
    this.startCleanup();
  }

  startCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredBlocks();
      this.cleanupEmptyQueues();
      Database.rateLimits.cleanup();
      Database.queueEntries.cleanupOld();
    }, 60000);
  }

  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  getLimitForCommand(command) {
    return this.config.perCommandLimits[command] || this.config.maxRequests;
  }

  getWindowStart() {
    return Math.floor(Date.now() / this.config.windowMs) * this.config.windowMs;
  }

  isBlocked(record) {
    return record && record.blocked_until > Date.now();
  }

  async checkLimit(userId, command) {
    const limit = this.getLimitForCommand(command);
    const windowStart = this.getWindowStart();
    const now = Date.now();

    let record = await Database.rateLimits.get(userId, command);

    if (!record) {
      await Database.rateLimits.set(userId, command, 1, windowStart);
      return {
        allowed: true,
        remaining: limit - 1,
        resetTime: windowStart + this.config.windowMs,
        blocked: false,
        blockRemaining: 0,
        queued: false,
        queuePosition: 0,
      };
    }

    if (this.isBlocked(record)) {
      const blockRemaining = Math.ceil((record.blocked_until - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetTime: record.blocked_until,
        blocked: true,
        blockRemaining,
        queued: false,
        queuePosition: 0,
      };
    }

    if (record.window_start !== windowStart) {
      await Database.rateLimits.resetWindow(userId, command);
      record = await Database.rateLimits.get(userId, command);
    }

    const remaining = Math.max(0, limit - record.count);
    const allowed = record.count < limit;

    if (allowed) {
      // Increment count when allowed
      await Database.rateLimits.increment(userId, command);
      // Return updated remaining
      return {
        allowed: true,
        remaining: Math.max(0, limit - record.count - 1),
        resetTime: windowStart + this.config.windowMs,
        blocked: false,
        blockRemaining: 0,
        queued: false,
        queuePosition: 0,
      };
    }

    return {
      allowed: false,
      remaining: 0,
      resetTime: windowStart + this.config.windowMs,
      blocked: false,
      blockRemaining: 0,
      queued: false,
      queuePosition: 0,
    };
  }

  async acquireSlot(userId, command, ctx = null) {
    const check = await this.checkLimit(userId, command);
    
    if (check.allowed) {
      const key = `${userId}:${command}`;
      this.activeCommands.set(key, (this.activeCommands.get(key) || 0) + 1);
      return { success: true, queued: false };
    }

    if (check.blocked) {
      return { 
        success: false, 
        queued: false, 
        blocked: true, 
        blockRemaining: check.blockRemaining,
        message: `⏳ Anda diblokir sementara. Coba lagi dalam ${check.blockRemaining} detik.`
      };
    }

    if (!this.config.queueEnabled) {
      return { 
        success: false, 
        queued: false, 
        blocked: false,
        message: `⚡ Rate limit tercapai (${this.getLimitForCommand(command)} req/${this.config.windowMs/1000}s). Silakan tunggu sebentar.`
      };
    }

    const queueKey = `${userId}:${command}`;
    let queue = this.queues.get(queueKey);
    
    if (!queue) {
      queue = [];
      this.queues.set(queueKey, queue);
    }

    const position = queue.length + 1;
    const queueId = await Database.queueEntries.insert(userId, command, position);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const idx = queue.findIndex(q => q.queueId === queueId);
        if (idx !== -1) {
          queue.splice(idx, 1);
          Database.queueEntries.updateStatus(queueId, 'timeout');
        }
        resolve({ 
          success: false, 
          queued: true, 
          timeout: true,
          message: `⏰ Timeout menunggu antrean (${this.config.queueTimeout/1000} detik). Silakan coba lagi.`
        });
      }, this.config.queueTimeout);

      queue.push({
        queueId,
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        ctx,
        command,
        userId,
        position,
        queuedAt: Date.now(),
      });

      if (ctx) {
        ctx.reply(`⏳ Anda dalam antrean posisi ${position}. Silakan tunggu...`)
          .catch(() => {});
      }

      logger.info({ userId, command, position, queueId }, 'User queued for command');
    });
  }

  releaseSlot(userId, command) {
    const key = `${userId}:${command}`;
    const current = this.activeCommands.get(key) || 0;
    
    if (current <= 1) {
      this.activeCommands.delete(key);
    } else {
      this.activeCommands.set(key, current - 1);
    }

    this.processQueue(userId, command);
  }

  async processQueue(userId, command) {
    const queueKey = `${userId}:${command}`;
    const queue = this.queues.get(queueKey);
    
    if (!queue || queue.length === 0) {
      return;
    }

    const check = await this.checkLimit(userId, command);
    
    if (check.allowed) {
      const next = queue.shift();
      await Database.queueEntries.updateStatus(next.queueId, 'processing');
      this.activeCommands.set(queueKey, (this.activeCommands.get(queueKey) || 0) + 1);
      next.resolve({ success: true, queued: true });
      logger.info({ userId, command, queueId: next.queueId }, 'Processing queued command');
    }
  }

  cleanupExpiredBlocks() {
    const now = Date.now();
    for (const [userId, commands] of this.activeCommands) {
    }
  }

  cleanupEmptyQueues() {
    for (const [key, queue] of this.queues) {
      if (queue.length === 0) {
        this.queues.delete(key);
      }
    }
  }

  getStatus(userId) {
    const limits = Database.rateLimits.getAllForUser(userId);
    const active = {};
    
    for (const [key, count] of this.activeCommands) {
      if (key.startsWith(`${userId}:`)) {
        const cmd = key.split(':')[1];
        active[cmd] = count;
      }
    }

    const queued = {};
    for (const [key, queue] of this.queues) {
      if (key.startsWith(`${userId}:`)) {
        const cmd = key.split(':')[1];
        queued[cmd] = queue.length;
      }
    }

    return { limits, active, queued };
  }

  async forceUnblock(userId, command) {
    await Database.rateLimits.unblock(userId, command);
    logger.warn({ userId, command }, 'Force unblocked user');
  }

  getConfig() {
    return { ...this.config };
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info({ config: this.config }, 'Rate limiter config updated');
  }
}

let rateLimiterInstance = null;

export function createRateLimiter(config) {
  if (!rateLimiterInstance) {
    rateLimiterInstance = new RateLimiter(config);
  }
  return rateLimiterInstance;
}

export function getRateLimiter() {
  return rateLimiterInstance;
}

export function destroyRateLimiter() {
  if (rateLimiterInstance) {
    rateLimiterInstance.stopCleanup();
    rateLimiterInstance = null;
  }
}

export default RateLimiter;