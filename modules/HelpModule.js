import BaseModule from './BaseModule.js';

class HelpModule extends BaseModule {
  constructor() {
    super();
    this.name = 'help';
    this.description = 'Modul untuk command /help';
    this.version = '1.0.0';
    this.author = 'Bot Developer';
    this.commands = [
      { command: 'help', description: '📋 Menampilkan bantuan', adminOnly: false, rateLimit: false }
    ];
  }

  async init(bot, config) {
    await super.init(bot, config);
  }

  registerHandlers() {
    this.rateLimitedCommand('help', '📋 Menampilkan bantuan', async (ctx) => {
      let helpText = `📋 *Daftar Perintah:*\n\n`;
      
      if (this.config.allCommands && this.config.allCommands.length > 0) {
        this.config.allCommands.forEach(cmd => {
          const adminTag = cmd.adminOnly ? ' 🔒' : '';
          helpText += `/${cmd.command} - ${cmd.description}${adminTag}\n`;
        });
      } else {
        this.commands.forEach(cmd => {
          helpText += `/${cmd.command} - ${cmd.description}\n`;
        });
      }
      
      helpText += `\n🔒 = Hanya untuk admin\n`;
      helpText += `\nContoh: /echo Halo dunia!`;
      
      await ctx.reply(helpText, { parse_mode: 'Markdown' });
    }, { rateLimit: false });
  }
}

export default HelpModule;