require('dotenv').config();
const { Telegraf } = require('telegraf');
const ModuleLoader = require('./modules/ModuleLoader');

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
  // Download endpoint berdasarkan tracking user: GET https://tracks.monochrome.st/track/{id} -> stream
  monochromeDownloadEndpoint: '/track'
};

console.log('🚀 Starting bot...');
console.log(`📛 Bot: ${config.botName} v${config.botVersion}`);
console.log(`👤 Author: ${config.authorName} <${config.authorEmail}>`);
console.log(`🔐 Admin IDs: ${adminIds.length > 0 ? adminIds.join(', ') : '(none)'}`);

// ============================================
// INISIALISASI BOT
// ============================================
const bot = new Telegraf(config.botToken);

// Global error handler
bot.catch((err, ctx) => {
  console.error('❌ Global Error:', err);
  if (ctx) {
    ctx.reply('❌ Terjadi kesalahan. Silakan coba lagi nanti.');
  }
});

// ============================================
// LOAD MODULES
// ============================================
const moduleLoader = new ModuleLoader(bot, config);

moduleLoader.loadModules()
  .then(() => {
    // Launch bot setelah modules loaded
    return bot.launch();
  })
  .then(() => {
    console.log('✅ Bot sedang berjalan...');
    console.log('📝 Tekan Ctrl+C untuk berhenti');
  })
  .catch((err) => {
    console.error('❌ Gagal memulai bot:', err);
    process.exit(1);
  });

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
process.once('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('\n🛑 Shutting down...');
  bot.stop('SIGTERM');
});

// ============================================
// EXPORTS (untuk testing/debugging)
// ============================================
module.exports = { bot, moduleLoader, config };