const BaseModule = require('./BaseModule');

class HelpModule extends BaseModule {
  constructor() {
    super();
    this.name = 'help';
    this.description = 'Modul untuk command /help';
    this.version = '1.0.0';
    this.author = 'Bot Developer';
    this.commands = [
      { command: 'help', description: '📋 Menampilkan bantuan', adminOnly: false }
    ];
  }

  async init(bot, config) {
    await super.init(bot, config);
  }

  registerHandlers() {
    this.bot.help(async (ctx) => {
      // Generate help dari semua command yang terdaftar
      let helpText = `📋 *Daftar Perintah:*\n\n`;
      
      // Ambil semua command dari module loader jika ada
      if (this.config.allCommands && this.config.allCommands.length > 0) {
        this.config.allCommands.forEach(cmd => {
          const adminTag = cmd.adminOnly ? ' 🔒' : '';
          helpText += `/${cmd.command} - ${cmd.description}${adminTag}\n`;
        });
      } else {
        // Fallback ke command module ini
        this.commands.forEach(cmd => {
          helpText += `/${cmd.command} - ${cmd.description}\n`;
        });
      }
      
      helpText += `\n🔒 = Hanya untuk admin\n`;
      helpText += `\nContoh: /echo Halo dunia!`;
      
      await ctx.reply(helpText, { parse_mode: 'Markdown' });
    });
  }
}

module.exports = HelpModule;