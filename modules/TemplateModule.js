/**
 * TEMPLATE MODULE - Copy this file to create new modules
 * 
 * Naming convention: NamaModule.js (PascalCase)
 * Class name: NamaModule (extends BaseModule)
 * 
 * Contoh: 
 * - File: WeatherModule.js
 * - Class: WeatherModule extends BaseModule
 * - Module name: 'weather' (lowercase)
 */

import BaseModule from './BaseModule.js';

class TemplateModule extends BaseModule {
  constructor() {
    super();
    // REQUIRED: Unique module name (lowercase, no spaces)
    this.name = 'template';
    
    // REQUIRED: Module description
    this.description = 'Template untuk membuat module baru';
    
    // OPTIONAL: Version
    this.version = '1.0.0';
    
    // OPTIONAL: Author
    this.author = 'Your Name';
    
    // REQUIRED: Commands yang didaftarkan ke Telegram
    // adminOnly: true = hanya admin bisa akses
    this.commands = [
      { 
        command: 'template',      // Command name (tanpa /)
        description: 'Contoh command template', 
        adminOnly: false          // true = hanya admin
      },
      { 
        command: 'adminonly', 
        description: 'Command hanya untuk admin', 
        adminOnly: true 
      }
    ];
    
    // OPTIONAL: Jika true, SEMUA command di module ini butuh admin
    // this.adminOnly = false;
    
    // OPTIONAL: Disable module tanpa hapus file
    // this.enabled = true;
  }

  /**
   * Initialize module - WAJIB diimplementasikan
   * Dipanggil saat bot startup
   */
  async init(bot, config) {
    // PANGIL SELALU: super.init() untuk setup base
    await super.init(bot, config);
    
    // Config tersedia di this.config:
    // - this.config.botToken
    // - this.config.adminIds (array string)
    // - this.config.authorName
    // - this.config.authorEmail
    // - this.config.botName
    // - this.config.botVersion
    // - this.config.allCommands (array semua command untuk help)
    
    this.logger.info(`Module initialized`);
  }

  /**
   * Register event handlers - WAJIB diimplementasikan
   * Di sini daftarkan command handlers, hears, on, dll
   */
  registerHandlers() {
    // ===== COMMAND HANDLERS =====
    
    // Command dasar: /template
    this.rateLimitedCommand('template', 'Contoh command template', async (ctx) => {
      await ctx.reply('✅ Template command works!');
    });

    // Command dengan admin middleware (hanya admin)
    this.rateLimitedCommand('adminonly', 'Command hanya untuk admin', async (ctx) => {
      await ctx.reply('🔒 Ini hanya bisa diakses admin!');
    }, { adminOnly: true });

    // ===== HEARS (keyword matching) =====
    
    // Merespons kata kunci tertentu
    this.bot.hears(/^hai$/i, async (ctx) => {
      await ctx.reply('Hai juga! 👋');
    });

    // ===== ON (event handlers) =====
    
    // Handle semua pesan teks
    // this.bot.on('text', async (ctx) => { ... });

    // Handle photo
    // this.bot.on('photo', async (ctx) => { ... });

    // ===== ADVANCED: Conversation/Scene =====
    // Untuk multi-step conversation, gunakan Telegraf Scenes
    // import { Scenes } from 'telegraf';
    // const scene = new Scenes.WizardScene('sceneName', ...);
    // this.bot.use(scene.middleware());
  }

  // ===== HELPER METHODS (tersedia dari BaseModule) =====
  
  // this.isAdmin(userId) - Cek apakah user admin
  // this.adminOnlyMiddleware() - Middleware proteksi admin
  // this.reply(ctx, text, options) - Reply dengan Markdown default
  // this.replyError(ctx, error) - Reply error standar
  // this.formatBytes(bytes) - Format bytes (di SystemModule)
  // this.formatUptime(seconds) - Format uptime (di SystemModule)
}

export default TemplateModule;

// ============================================
// CARA MEMBUAT MODULE BARU (Step by Step):
// ============================================
//
// 1. Copy file ini: cp modules/TemplateModule.js modules/NamaModule.js
//
// 2. Ubah nama class dan file:
//    class NamaModule extends BaseModule
//
// 3. Ubah this.name = 'nama' (lowercase, unique)
//
// 4. Isi this.commands array dengan command Anda
//
// 5. Implement registerHandlers() dengan logic command
//
// 6. Restart bot - auto load!
//
// ============================================
// CONTOH MODULE SEDERHANA:
// ============================================
/*
import BaseModule from './BaseModule.js';

class CuacaModule extends BaseModule {
  constructor() {
    super();
    this.name = 'cuaca';
    this.description = 'Cek cuaca';
    this.commands = [
      { command: 'cuaca', description: '🌤 Cek cuaca hari ini', adminOnly: false }
    ];
  }

  async init(bot, config) {
    await super.init(bot, config);
    this.apiKey = config.weatherApiKey; // Dari .env
  }

  registerHandlers() {
    this.rateLimitedCommand('cuaca', '🌤 Cek cuaca hari ini', async (ctx) => {
      const city = ctx.message.text.split(' ').slice(1).join(' ') || 'Jakarta';
      // Panggil API cuaca...
      await ctx.reply(`🌤 Cuaca di ${city}: Cerah, 30°C`);
    });
  }
}

export default CuacaModule;
*/

// ============================================
// TIPS:
// ============================================
// - Gunakan this.config untuk akses .env variables
// - Gunakan this.isAdmin(userId) untuk cek admin manual
// - Gunakan this.adminOnlyMiddleware() untuk proteksi command
// - Module otomatis load saat restart bot
// - Untuk development: gunakan ModuleLoader.reloadModule('nama')