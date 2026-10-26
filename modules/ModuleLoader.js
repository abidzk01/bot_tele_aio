const fs = require('fs');
const path = require('path');

/**
 * ModuleLoader - Auto load modules from modules folder
 * 
 * Cara menambah module baru:
 * 1. Buat file di folder modules/ (contoh: MyModule.js)
 * 2. Extends BaseModule
 * 3. Implement init(), registerHandlers()
 * 4. Restart bot - auto load
 */

class ModuleLoader {
  constructor(bot, config) {
    this.bot = bot;
    this.config = config;
    this.modules = new Map();
    this.allCommands = [];
  }

  /**
   * Load all modules from modules folder
   */
  async loadModules() {
    const modulesPath = path.join(__dirname);
    
    // Read all .js files except BaseModule, ModuleLoader, and index
    const files = fs.readdirSync(modulesPath)
      .filter(file => 
        file.endsWith('.js') && 
        !['BaseModule.js', 'ModuleLoader.js', 'index.js'].includes(file)
      );

    console.log(`📦 Loading ${files.length} modules...`);

    for (const file of files) {
      try {
        await this.loadModule(file);
      } catch (error) {
        console.error(`❌ Failed to load module ${file}:`, error.message);
      }
    }

    // Register all slash commands to Telegram
    await this.registerSlashCommands();

    console.log(`✅ All modules loaded (${this.modules.size} modules)`);
    return this.modules;
  }

  /**
   * Load single module
   */
  async loadModule(filename) {
    const modulePath = path.join(__dirname, filename);
    const ModuleClass = require(modulePath);
    
    // Instantiate module
    const moduleInstance = new ModuleClass();
    
    // Validate module
    if (!moduleInstance.name || typeof moduleInstance.init !== 'function') {
      throw new Error(`Invalid module structure: ${filename}`);
    }

    // Initialize module with bot and config
    await moduleInstance.init(this.bot, {
      ...this.config,
      allCommands: this.allCommands // Pass all commands for help generation
    });

    // Store module
    this.modules.set(moduleInstance.name, moduleInstance);

    // Collect commands for slash command registration
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

  /**
   * Register all slash commands to Telegram
   */
  async registerSlashCommands() {
    if (this.allCommands.length === 0) return;

    const commands = this.allCommands.map(cmd => ({
      command: cmd.command,
      description: cmd.description
    }));

    try {
      await this.bot.telegram.setMyCommands(commands);
      console.log(`✅ Registered ${commands.length} slash commands to Telegram`);
    } catch (error) {
      console.error('❌ Failed to register slash commands:', error.message);
    }
  }

  /**
   * Get loaded module by name
   */
  getModule(name) {
    return this.modules.get(name);
  }

  /**
   * Get all loaded modules
   */
  getAllModules() {
    return Array.from(this.modules.values());
  }

  /**
   * Reload a specific module (for development)
   */
  async reloadModule(moduleName) {
    // Clear require cache
    const modulesPath = path.join(__dirname);
    const files = fs.readdirSync(modulesPath)
      .filter(file => file.endsWith('.js') && !['BaseModule.js', 'ModuleLoader.js', 'index.js'].includes(file));

    for (const file of files) {
      const modulePath = path.join(modulesPath, file);
      delete require.cache[require.resolve(modulePath)];
    }

    // Remove old module
    const oldModule = this.modules.get(moduleName);
    if (oldModule) {
      this.allCommands = this.allCommands.filter(cmd => cmd.module !== moduleName);
      this.modules.delete(moduleName);
    }

    // Reload
    for (const file of files) {
      try {
        await this.loadModule(file);
      } catch (error) {
        console.error(`❌ Failed to reload module ${file}:`, error.message);
      }
    }

    await this.registerSlashCommands();
  }
}

module.exports = ModuleLoader;