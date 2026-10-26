const BaseModule = require('./BaseModule');

class AboutModule extends BaseModule {
  constructor() {
    super();
    this.name = 'about';
    this.description = 'Modul untuk command /about';
    this.version = '1.0.0';
    this.author = 'Bot Developer';
    this.commands = [
      { command: 'about', description: 'ℹ️ Info tentang bot', adminOnly: false }
    ];
  }

  async init(bot, config) {
    await super.init(bot, config);
  }

  registerHandlers() {
    this.bot.command('about', async (ctx) => {
      await ctx.reply(
        `🤖 *${this.config.botName || 'Simple Telegram Bot'}*\n\n` +
        `Versi: ${this.config.botVersion || '1.0.0'}\n` +
        `Dibangun dengan: Node.js + Telegraf\n` +
        `Author: ${this.config.authorName || 'Unknown'}\n` +
        `Email: ${this.config.authorEmail || 'N/A'}`,
        { parse_mode: 'Markdown' }
      );
    });
  }
}

module.exports = AboutModule;