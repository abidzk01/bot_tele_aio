import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { ModuleLoader } from './modules/ModuleLoader.js';
import { Database } from './modules/Database.js';
import { createLogger, getLogger } from './modules/Logger.js';
import { createRateLimiter, destroyRateLimiter } from './modules/RateLimiter.js';

// ============================================
// VALIDASI KONFIGURASI
// ============================================
if (!process.env.BOT_TOKEN || process.env.BOT_TOKEN === 'your_bot_token_here_from_BotFather') {
  console.error('❌ BOT_TOKEN tidak ditemukan di .env file');
  console.error('   Silakan copy .env.example ke .env dan isi BOT_TOKEN');
  process.exit(1);
}

// Parse admin IDs dari .env (comma-separated)
const adminIds = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(id => id.length > 0);

// ============================================
// INISIALISASI DATABASE, LOGGER, RATE LIMITER
// ============================================
const logger = createLogger('Main');
const rateLimiter = createRateLimiter();

// Initialize database FIRST (creates tables, runs schema)
await Database.init();
const db = Database;

logger.info('✅ Database initialized');

// Config object untuk modules
const config = {
  botToken: process.env.BOT_TOKEN,
  botName: process.env.BOT_NAME || 'Simple Telegram Bot',
  botVersion: process.env.BOT_VERSION || '1.0.0',
  authorName: process.env.AUTHOR_NAME || 'Unknown',
  authorEmail: process.env.AUTHOR_EMAIL || 'N/A',
  adminIds: adminIds,
  // Monochrome API config
  monochromeApiBaseUrl: 'https://tracks.monochrome.st',
  monochromeSearchEndpoint: '/api/v1/search',
  monochromeTrackEndpoint: '/api/v1/track',
  monochromeDownloadEndpoint: '/track',
  // Core services
  logger,
  db,
  rateLimiter,
};

logger.info('🚀 Starting bot...');
logger.info({ botName: config.botName, version: config.botVersion }, 'Bot config');
logger.info({ adminCount: adminIds.length }, 'Admin IDs loaded');

// ============================================
// INISIALISASI BOT
// ============================================
const bot = new Telegraf(config.botToken);

// Global error handler
bot.catch((err, ctx) => {
  logger.error({ err, updateType: ctx?.updateType }, 'Global error');
  if (ctx) {
    ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi nanti.').catch(() => {});
  }
});

// ============================================
// LOAD MODULES
// ============================================
const moduleLoader = new ModuleLoader(bot, config);

await moduleLoader.loadModules();

logger.info('✅ Modules loaded, launching bot...');
await bot.launch();

logger.info('✅ Bot sedang berjalan...');
logger.info('📝 Tekan Ctrl+C untuk berhenti');

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down...');
  
  destroyRateLimiter();
  
  try {
    await bot.stop(signal);
    logger.info('Bot stopped gracefully');
  } catch (err) {
    logger.error({ err }, 'Error during shutdown');
  }
  
  Database.closeDb();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

// ============================================
// EXPORTS (untuk testing/debugging)
// ============================================
export { bot, moduleLoader, config, db, logger, rateLimiter };