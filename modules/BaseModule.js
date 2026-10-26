/**
 * BaseModule - Base class for all bot modules
 * 
 * Standar module:
 * - name: string (unique, lowercase, no spaces)
 * - description: string (untuk help & slash command)
 * - commands: array of { command, description, adminOnly? }
 * - adminOnly: boolean (jika true, semua command butuh admin)
 * - init(bot, config): async function - dipanggil saat load
 * - handlers: object berisi handler functions
 */

class BaseModule {
  constructor() {
    this.name = 'base';
    this.description = 'Base module';
    this.version = '1.0.0';
    this.author = 'Unknown';
    this.commands = []; // [{ command, description, adminOnly }]
    this.adminOnly = false; // default false
    this.enabled = true;
  }

  /**
   * Initialize module - override di child class
   * @param {Telegraf} bot - Bot instance
   * @param {Object} config - Config dari .env & globals
   */
  async init(bot, config) {
    this.bot = bot;
    this.config = config;
    this.adminIds = config.adminIds || [];
    
    // Register commands ke bot
    this.registerCommands();
    
    // Register handlers
    this.registerHandlers();
    
    console.log(`✅ Module loaded: ${this.name} v${this.version}`);
  }

  /**
   * Register slash commands ke Telegram
   */
  registerCommands() {
    if (this.commands.length > 0) {
      // Commands akan dikumpulkan dan di-set di ModuleLoader
    }
  }

  /**
   * Register event handlers - override di child class
   */
  registerHandlers() {
    // Override di child class
  }

  /**
   * Check apakah user adalah admin
   * @param {number|string} userId - Telegram user ID
   * @returns {boolean}
   */
  isAdmin(userId) {
    return this.adminIds.includes(String(userId));
  }

  /**
   * Middleware untuk cek admin
   * @param {Context} ctx - Telegraf context
   * @param {Function} next - Next middleware
   */
  adminOnlyMiddleware() {
    return async (ctx, next) => {
      if (!this.isAdmin(ctx.from?.id)) {
        return ctx.reply('❌ Perintah ini hanya untuk admin.');
      }
      return next();
    };
  }

  /**
   * Helper: reply dengan format konsisten
   */
  reply(ctx, text, options = {}) {
    return ctx.reply(text, { parse_mode: 'Markdown', ...options });
  }

  /**
   * Helper: reply error
   */
  replyError(ctx, error) {
    console.error(`[${this.name}] Error:`, error);
    return ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi nanti.');
  }

  /**
   * Get command definitions untuk slash command registration
   * @returns {Array}
   */
  getCommandDefinitions() {
    return this.commands.map(cmd => ({
      command: cmd.command,
      description: cmd.description
    }));
  }
}

module.exports = BaseModule;