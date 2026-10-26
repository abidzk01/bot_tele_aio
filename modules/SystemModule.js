import BaseModule from './BaseModule.js';
import os from 'os';

class SystemModule extends BaseModule {
  constructor() {
    super();
    this.name = 'system';
    this.description = 'Modul untuk command /system (admin only)';
    this.version = '1.0.0';
    this.author = 'Bot Developer';
    this.commands = [
      { command: 'system', description: '💻 Cek info sistem server', adminOnly: true, rateLimit: true }
    ];
    this.adminOnly = true;
  }

  async init(bot, config) {
    await super.init(bot, config);
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (secs) parts.push(`${secs}s`);
    return parts.join(' ') || '0s';
  }

  registerHandlers() {
    this.rateLimitedCommand('system', '💻 Cek info sistem server', async (ctx) => {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memUsage = ((usedMem / totalMem) * 100).toFixed(1);
      
      const cpus = os.cpus();
      const cpuModel = cpus[0].model;
      const cpuCount = cpus.length;
      
      const loadAvg = os.loadavg();
      const uptime = this.formatUptime(os.uptime());
      const platform = os.platform();
      const arch = os.arch();
      const nodeVersion = process.version;
      const hostname = os.hostname();
      
      const cpuUsage = cpus.map((cpu, i) => {
        const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
        const idle = cpu.times.idle;
        const usage = ((total - idle) / total * 100).toFixed(1);
        return `  Core ${i + 1}: ${usage}%`;
      }).join('\n');

      await ctx.reply(
        `💻 *SYSTEM INFO*\n\n` +
        `🖥 *Host:* ${hostname}\n` +
        `🖥 *OS:* ${platform} (${arch})\n` +
        `⏱ *Uptime:* ${uptime}\n\n` +
        `🧠 *Memory:*\n` +
        `  Total: ${this.formatBytes(totalMem)}\n` +
        `  Used: ${this.formatBytes(usedMem)} (${memUsage}%)\n` +
        `  Free: ${this.formatBytes(freeMem)}\n\n` +
        `⚡ *CPU:* ${cpuModel}\n` +
        `  Cores: ${cpuCount}\n` +
        `  Load Avg: ${loadAvg.map(l => l.toFixed(2)).join(', ')}\n` +
        `${cpuUsage}\n\n` +
        `🟢 *Node.js:* ${nodeVersion}\n` +
        `📦 *Bot:* ${this.config.botName || 'Simple Bot'} v${this.config.botVersion || '1.0.0'}`,
        { parse_mode: 'Markdown' }
      );
    }, { adminOnly: true });
  }
}

export default SystemModule;