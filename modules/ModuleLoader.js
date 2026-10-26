import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from './Logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('ModuleLoader');

/**
 * ModuleLoader - Auto load modules from modules folder
 * 
 * Cara menambah module baru:
 * 1. Buat file di folder modules/ (contoh: MyModule.js)
 * 2. Extends BaseModule
 * 3. Implement init(), registerHandlers()
 * 4. Restart bot - auto load
 */

export class ModuleLoader {
  constructor(bot, config) {
    this.bot = bot;
    this.config = config;
    this.modules = new Map();
    this.allCommands = [];
    this.logger = config.logger || logger;
  }

  async loadModules() {
    const modulesPath = __dirname;
    
    const files = fs.readdirSync(modulesPath)
      .filter(file => 
        file.endsWith('.js') && 
        !['BaseModule.js', 'ModuleLoader.js', 'Database.js', 'Logger.js', 'RateLimiter.js'].includes(file)
      );

    this.logger.info({ count: files.length }, 'Loading modules...');

    for (const file of files) {
      try {
        await this.loadModule(file);
      } catch (error) {
        this.logger.error({ err: error, file }, `Failed to load module`);
      }
    }

    await this.registerSlashCommands();

    this.logger.info({ count: this.modules.size }, 'All modules loaded');
    return this.modules;
  }

  async loadModule(filename) {
    const modulePath = path.join(__dirname, filename);
    const moduleUrl = new URL('file://' + modulePath.replace(/\\/g, '/'));
    const moduleModule = await import(moduleUrl.href);
    const ModuleClass = moduleModule.default || moduleModule;
    
    const moduleInstance = new ModuleClass();
    
    if (!moduleInstance.name || typeof moduleInstance.init !== 'function') {
      throw new Error(`Invalid module structure: ${filename}`);
    }

    await moduleInstance.init(this.bot, {
      ...this.config,
      allCommands: this.allCommands
    });

    this.modules.set(moduleInstance.name, moduleInstance);

    if (moduleInstance.commands && moduleInstance.commands.length > 0) {
      moduleInstance.commands.forEach(cmd => {
        this.allCommands.push({
          command: cmd.command,
          description: cmd.description,
          adminOnly: cmd.adminOnly || moduleInstance.adminOnly || false,
          module: moduleInstance.name
        });
      });
    }

    return moduleInstance;
  }

  async registerSlashCommands() {
    if (this.allCommands.length === 0) return;

    const commands = this.allCommands.map(cmd => ({
      command: cmd.command,
      description: cmd.description
    }));

    try {
      await this.bot.telegram.setMyCommands(commands);
      this.logger.info({ count: commands.length }, 'Registered slash commands to Telegram');
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to register slash commands');
    }
  }

  getModule(name) {
    return this.modules.get(name);
  }

  getAllModules() {
    return Array.from(this.modules.values());
  }

  async reloadModule(moduleName) {
    const modulesPath = __dirname;
    const files = fs.readdirSync(modulesPath)
      .filter(file => file.endsWith('.js') && !['BaseModule.js', 'ModuleLoader.js', 'Database.js', 'Logger.js', 'RateLimiter.js'].includes(file));

    for (const file of files) {
      const modulePath = path.join(modulesPath, file);
      delete globalThis.require?.cache?.[require.resolve(modulePath)];
    }

    const oldModule = this.modules.get(moduleName);
    if (oldModule) {
      this.allCommands = this.allCommands.filter(cmd => cmd.module !== moduleName);
      this.modules.delete(moduleName);
    }

    for (const file of files) {
      try {
        await this.loadModule(file);
      } catch (error) {
        this.logger.error({ err: error, file }, 'Failed to reload module');
      }
    }

    await this.registerSlashCommands();
  }
}

export default ModuleLoader;