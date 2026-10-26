const BaseModule = require('./BaseModule');

class TimeModule extends BaseModule {
  constructor() {
    super();
    this.name = 'time';
    this.description = 'Modul untuk command /time';
    this.version = '1.0.0';
    this.author = 'Bot Developer';
    this.commands = [
      { command: 'time', description: '🕐 Menampilkan waktu server (WIB)', adminOnly: false }
    ];
  }

  async init(bot, config) {
    await super.init(bot, config);
  }

  registerHandlers() {
    this.bot.command('time', async (ctx) => {
      const now = new Date();
      const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000); // UTC+7
      await ctx.reply(`🕐 Waktu saat ini (WIB): ${wib.toLocaleString('id-ID')}`);
    });
  }
}

module.exports = TimeModule;