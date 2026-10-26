import BaseModule from './BaseModule.js';

class EchoModule extends BaseModule {
  constructor() {
    super();
    this.name = 'echo';
    this.description = 'Modul untuk command /echo';
    this.version = '1.0.0';
    this.author = 'Bot Developer';
    this.commands = [
      { command: 'echo', description: '📢 Mengulang teks yang dikirim', adminOnly: false, rateLimit: true }
    ];
  }

  async init(bot, config) {
    await super.init(bot, config);
  }

  registerHandlers() {
    this.rateLimitedCommand('echo', '📢 Mengulang teks yang dikirim', async (ctx) => {
      const text = ctx.message.text.split(' ').slice(1).join(' ');
      if (!text) {
        return ctx.reply('Gunakan: /echo <teks yang ingin diulang>');
      }
      await ctx.reply(`📢 Echo: ${text}`);
    });
  }
}

export default EchoModule;