const BaseModule = require('./BaseModule');

class EchoModule extends BaseModule {
  constructor() {
    super();
    this.name = 'echo';
    this.description = 'Modul untuk command /echo';
    this.version = '1.0.0';
    this.author = 'Bot Developer';
    this.commands = [
      { command: 'echo', description: '📢 Mengulang teks yang dikirim', adminOnly: false }
    ];
  }

  async init(bot, config) {
    await super.init(bot, config);
  }

  registerHandlers() {
    this.bot.command('echo', async (ctx) => {
      const text = ctx.message.text.split(' ').slice(1).join(' ');
      if (!text) {
        return ctx.reply('Gunakan: /echo <teks yang ingin diulang>');
      }
      await ctx.reply(`📢 Echo: ${text}`);
    });
  }
}

module.exports = EchoModule;