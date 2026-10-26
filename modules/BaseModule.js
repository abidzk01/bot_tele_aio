/**
 * BaseModule - Base class for all bot modules
 * 
 * Standar module:
 * - name: string (unique, lowercase, no spaces)
 * - description: string (untuk help & slash command)
 * - commands: array of { command, description, adminOnly?, rateLimit?: object }
 * - adminOnly: boolean (jika true, semua command butuh admin)
 * - init(bot, config): async function - dipanggil saat load
 * - handlers: object berisi handler functions
 */

import { createLogger } from './Logger.js';
import { getRateLimiter } from './RateLimiter.js';

class BaseModule {
  constructor() {
    this.name = 'base';
    this.description = 'Base module';
    this.version = '1.0.0';
    this.author = 'Unknown';
    this.commands = []; // [{ command, description, adminOnly, rateLimit }]
    this.adminOnly = false;
    this.enabled = true;
    this.logger = null;
    this.rateLimiter = null;
    this.db = null;
  }

  async init(bot, config) {
    this.bot = bot;
    this.config = config;
    this.adminIds = config.adminIds || [];
    this.logger = config.logger || createLogger(this.name);
    this.rateLimiter = config.rateLimiter || getRateLimiter();
    this.db = config.db || null;

    this.registerCommands();
    this.registerHandlers();

    this.logger.info({ version: this.version }, `Module loaded: ${this.name}`);
  }

  registerCommands() {
    if (this.commands.length > 0) {
    }
  }

  registerHandlers() {
  }

  isAdmin(userId) {
    return this.adminIds.includes(String(userId));
  }

  adminOnlyMiddleware() {
    return async (ctx, next) => {
      if (!this.isAdmin(ctx.from?.id)) {
        this.logger.warn({ userId: ctx.from?.id, command: ctx.message?.text }, 'Admin access denied');
        return ctx.reply('❌ Perintah ini hanya untuk admin.');
      }
      return next();
    };
  }

  rateLimitMiddleware(commandName) {
    return async (ctx, next) => {
      if (!this.rateLimiter) {
        return next();
      }

      const userId = ctx.from?.id;
      if (!userId) {
        return next();
      }

      const result = await this.rateLimiter.acquireSlot(String(userId), commandName, ctx);
      
      if (!result.success) {
        if (result.blocked) {
          return ctx.reply(`⏳ ${result.message}`);
        }
        if (result.timeout) {
          return ctx.reply(`⏰ ${result.message}`);
        }
        if (result.queued) {
          return;
        }
        return ctx.reply(`⚡ ${result.message || 'Rate limit tercapai. Silakan tunggu sebentar.'}`);
      }

      try {
        await next();
      } finally {
        this.rateLimiter.releaseSlot(String(userId), commandName);
      }
    };
  }

  rateLimitedCommand(commandName, description, handler, options = {}) {
    const { adminOnly = false, rateLimit = true } = options;
    
    const middlewares = [];
    
    if (adminOnly) {
      middlewares.push(this.adminOnlyMiddleware());
    }
    
    if (rateLimit && this.rateLimiter) {
      middlewares.push(this.rateLimitMiddleware(commandName));
    }

    this.bot.command(commandName, ...middlewares, async (ctx) => {
      const startTime = Date.now();
      try {
        await handler(ctx);
        const duration = Date.now() - startTime;
        this.logger.debug({ userId: ctx.from?.id, command: commandName, duration }, 'Command completed');
        
        if (this.db) {
          this.db.commandStats.record(commandName, duration);
          this.db.users.incrementCommands(ctx.from?.id);
        }
      } catch (error) {
        const duration = Date.now() - startTime;
        this.logger.error({ err: error, userId: ctx.from?.id, command: commandName, duration }, 'Command error');
        
        if (this.db) {
          this.db.commandStats.incrementErrors(commandName);
        }
        
        await this.replyError(ctx, error);
      }
    });

    // Only add to commands if not already present (avoid duplicates from constructor)
    if (!this.commands.some(c => c.command === commandName)) {
      this.commands.push({ 
        command: commandName, 
        description, 
        adminOnly,
        rateLimit 
      });
    }
  }

  reply(ctx, text, options = {}) {
    return ctx.reply(text, { parse_mode: 'Markdown', ...options });
  }

  replyError(ctx, error) {
    this.logger.error({ err: error }, `Error in ${this.name}`);
    return ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi nanti.');
  }

  getCommandDefinitions() {
    return this.commands.map(cmd => ({
      command: cmd.command,
      description: cmd.description
    }));
  }

  logUserAction(userId, action, metadata = {}) {
    this.logger.info({ userId, action, ...metadata }, 'User action');
  }
}

export default BaseModule;