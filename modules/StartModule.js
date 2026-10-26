const BaseModule = require('./BaseModule');
const { Markup } = require('telegraf');

class StartModule extends BaseModule {
  constructor() {
    super();
    this.name = 'start';
    this.description = 'Modul untuk command /start';
    this.version = '1.0.0';
    this.author = 'Bot Developer';
    this.commands = [
      { command: 'start', description: '🚀 Memulai bot', adminOnly: false }
    ];
  }

  async init(bot, config) {
    await super.init(bot, config);
  }

  registerHandlers() {
    // Command /start
    this.bot.start(this.adminOnlyMiddleware(), async (ctx) => {
      const name = ctx.from.first_name || 'User';
      await ctx.reply(
        `Halo ${name}! 👋\nSelamat datang di *${this.config.botName || 'Simple Bot'}*.\n\nGunakan /help untuk melihat daftar perintah.`,
        Markup.keyboard([
          ['/help', '/about'],
          ['/time', '/echo'],
          ['/system']
        ]).resize()
      );
    });

    // Handle text "start" atau "mulai"
    this.bot.hears(/^(start|mulai)$/i, async (ctx) => {
      // Trigger start command logic
      const name = ctx.from.first_name || 'User';
      await ctx.reply(
        `Halo ${name}! 👋\nGunakan /help untuk melihat daftar perintah.`,
        Markup.keyboard([
          ['/help', '/about'],
          ['/time', '/echo'],
          ['/system']
        ]).resize()
      );
    });
  }
}

module.exports = StartModule;