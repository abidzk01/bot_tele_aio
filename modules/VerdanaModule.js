import BaseModule from './BaseModule.js';
import { createLogger } from './Logger.js';
import Verdana from 'verdana';
import path from 'path';
import fs from 'fs';

class VerdanaModule extends BaseModule {
  constructor() {
    super();
    this.name = 'verdana';
    this.description = 'Multi-source music downloader using verdana (Qobuz, Tidal, Spotify, SoundCloud, Deezer)';
    this.version = '1.0.0';
    this.author = 'Bot Developer';
    this.commands = [
      { command: 'search', description: '🔍 Cari lagu dari multiple sources', adminOnly: false, rateLimit: true },
      { command: 'download', description: '⬇️ Download lagu dengan format pilihan', adminOnly: false, rateLimit: true }
    ];
    this.verdana = null;
    this.initialized = false;
  }

  async init(bot, config) {
    await super.init(bot, config);
    
    // Build verdana modules from config
    const verdanaConfig = {
      modules: {},
      logins: {}
    };
    
    const moduleConfigs = this.config.verdanaModules || {};
    
    for (const [moduleName, moduleCfg] of Object.entries(moduleConfigs)) {
      let moduleObj;
      
      switch (moduleName) {
        case 'qobuz':
          moduleObj = {
            hostnames: ['qobuz.com'],
            search: async (query, limit) => {
              const results = await this.verdana.search(query, limit);
              return results.qobuz || [];
            },
            login: async (username, password) => {
              if (this.verdana.modules.qobuz && this.verdana.modules.qobuz.login) {
                await this.verdana.modules.qobuz.login(username, password);
              }
            },
            getFormats: async (track) => {
              if (this.verdana.modules.qobuz && this.verdana.modules.qobuz.getFormats) {
                return this.verdana.modules.qobuz.getFormats(track);
              }
              return [];
            },
            getByUrl: async (url) => {
              if (this.verdana.modules.qobuz && this.verdana.modules.qobuz.getByUrl) {
                return this.verdana.modules.qobuz.getByUrl(url);
              }
              return { metadata: {}, getStream: async () => {} };
            }
          };
          break;
          
        case 'tidal':
          moduleObj = {
            hostnames: ['tidal.com'],
            search: async (query, limit) => {
              const results = await this.verdana.search(query, limit);
              return results.tidal || [];
            },
            login: async (username, password) => {
              if (this.verdana.modules.tidal && this.verdana.modules.tidal.login) {
                await this.verdana.modules.tidal.login(username, password);
              }
            },
            getFormats: async (track) => {
              if (this.verdana.modules.tidal && this.verdana.modules.tidal.getFormats) {
                return this.verdana.modules.tidal.getFormats(track);
              }
              return [];
            },
            getByUrl: async (url) => {
              if (this.verdana.modules.tidal && this.verdana.modules.tidal.getByUrl) {
                return this.verdana.modules.tidal.getByUrl(url);
              }
              return { metadata: {}, getStream: async () => {} };
            }
          };
          break;
          
        case 'spotify':
          moduleObj = {
            hostnames: ['open.spotify.com'],
            search: async (query, limit) => {
              const results = await this.verdana.search(query, limit);
              return results.spotify || [];
            },
            login: async (username, password) => {
              if (this.verdana.modules.spotify && this.verdana.modules.spotify.login) {
                await this.verdana.modules.spotify.login(username, password);
              }
            },
            getFormats: async (track) => {
              if (this.verdana.modules.spotify && this.verdana.modules.spotify.getFormats) {
                return this.verdana.modules.spotify.getFormats(track);
              }
              return [];
            },
            getByUrl: async (url) => {
              if (this.verdana.modules.spotify && this.verdana.modules.spotify.getByUrl) {
                return this.verdana.modules.spotify.getByUrl(url);
              }
              return { metadata: {}, getStream: async () => {} };
            }
          };
          break;
          
        case 'soundcloud':
          moduleObj = {
            hostnames: ['soundcloud.com'],
            search: async (query, limit) => {
              const results = await this.verdana.search(query, limit);
              return results.soundcloud || [];
            },
            login: async (clientId) => {
              if (this.verdana.modules.soundcloud && this.verdana.modules.soundcloud.login) {
                await this.verdana.modules.soundcloud.login(clientId);
              }
            },
            getFormats: async (track) => {
              if (this.verdana.modules.soundcloud && this.verdana.modules.soundcloud.getFormats) {
                return this.verdana.modules.soundcloud.getFormats(track);
              }
              return [];
            },
            getByUrl: async (url) => {
              if (this.verdana.modules.soundcloud && this.verdana.modules.soundcloud.getByUrl) {
                return this.verdana.modules.soundcloud.getByUrl(url);
              }
              return { metadata: {}, getStream: async () => {} };
            }
          };
          break;
          
        case 'deezer':
          moduleObj = {
            hostnames: ['deezer.com'],
            search: async (query, limit) => {
              const results = await this.verdana.search(query, limit);
              return results.deezer || [];
            },
            login: async (arl) => {
              if (this.verdana.modules.deezer && this.verdana.modules.deezer.login) {
                await this.verdana.modules.deezer.login(arl);
              }
            },
            getFormats: async (track) => {
              if (this.verdana.modules.deezer && this.verdana.modules.deezer.getFormats) {
                return this.verdana.modules.deezer.getFormats(track);
              }
              return [];
            },
            getByUrl: async (url) => {
              if (this.verdana.modules.deezer && this.verdana.modules.deezer.getByUrl) {
                return this.verdana.modules.deezer.getByUrl(url);
              }
              return { metadata: {}, getStream: async () => {} };
            }
          };
          break;
          
        default:
          moduleObj = {
            hostnames: ['unknown'],
            search: async () => [],
            getFormats: async () => [],
            getByUrl: async () => ({ metadata: {}, getStream: async () => {} })
          };
      }
      
      if (moduleObj) {
        verdanaConfig.modules[moduleName] = moduleObj;
      }
    }
    
    // Initialize verdana
    try {
      this.verdana = new Verdana(verdanaConfig);
      await this.verdana.login();
      this.initialized = true;
      const logger = createLogger('VerdanaModule');
      logger.info('Verdana module initialized with modules:', Object.keys(this.verdana.modules));
    } catch (error) {
      const logger = createLogger('VerdanaModule');
      logger.error('Failed to initialize verdana:', error.message);
      // Continue without verdana - use monochrome only
      this.initialized = false;
    }
  }

  async searchCommand(ctx) {
    const userId = ctx.from?.id;
    const args = ctx.text?.split(' ') || [];
    const query = args.slice(1).join(' ') || '';
    
    if (!query) {
      return await ctx.reply('❌ Masukkan query pencarian!\nContoh: /search Bohemian Rhapsody Queen');
    }
    
    if (!this.initialized || !this.verdana) {
      return await ctx.reply('❌ Verdana module belum terinisialisasi. Coba lagi nanti.');
    }
    
    // Show typing indicator
    await ctx.reply(`🔍 Sedang mencari: "${query}"...`);
    
    try {
      // Search across all configured modules
      const results = await this.verdana.search(query, 10);
      
      let response = `🔍 *Hasil Pencarian: "${query}"*\n\n`;
      let foundAny = false;
      
      // Format results from each source
      const sourceLabels = {
        qobuz: 'Qobuz',
        tidal: 'Tidal', 
        spotify: 'Spotify',
        soundcloud: 'SoundCloud',
        deezer: 'Deezer'
      };
      
      for (const [source, sourceResults] of Object.entries(results)) {
        if (sourceResults && sourceResults.length > 0) {
          foundAny = true;
          const label = sourceLabels[source] || source.toUpperCase();
          response += `📀 *${label}* (${sourceResults.length} hasil):\n`;
          
          // Show top 3 results per source
          for (let i = 0; i < Math.min(3, sourceResults.length); i++) {
            const track = sourceResults[i];
            const artist = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown';
            response += `   ${i + 1}. *${track.title}* - ${artist}\n`;
            if (track.duration) {
              const mins = Math.floor(track.duration / 60);
              const secs = track.duration % 60;
              response += `      ⏱ ${mins}:${secs < 10 ? '0' : ''}${secs}\n`;
            }
          }
          response += '\n';
        }
      }
      
      if (!foundAny) {
        return await ctx.reply(`❌ Tidak ada hasil untuk: "${query}"`);
      }
      
      response += `💡 Gunakan /download <sumber> <nomor> untuk memilih format dan download`;
      await ctx.reply(response, { parse_mode: 'Markdown' });
      
    } catch (error) {
      const logger = createLogger('VerdanaModule');
      logger.error('Search error:', error);
      await ctx.reply(`❌ Error saat search: ${error.message.substring(0, 200)}`);
    }
  }

  async downloadCommand(ctx) {
    const userId = ctx.from?.id;
    const args = ctx.text?.split(' ') || [];
    const [source, trackNumber] = args;
    
    if (!source || !trackNumber) {
      return await ctx.reply('❌ Format penggunaan: /download <sumber> <nomor>\n\nContoh: /download qobuz 1\nAtau: /download tidal 2');
    }
    
    if (!this.initialized || !this.verdana) {
      return await ctx.reply('❌ Verdana module belum terinisialisasi.');
    }
    
    // Parse source
    const sourceMap = {
      qobuz: 'qobuz',
      tidal: 'tidal', 
      spotify: 'spotify',
      soundcloud: 'soundcloud',
      deezer: 'deezer',
      mono: 'monochrome',
      monochrome: 'monochrome'
    };
    
    const selectedSourceKey = sourceMap[source.toLowerCase()] || source.toLowerCase();
    
    if (!this.verdana.modules[selectedSourceKey]) {
      return await ctx.reply(`❌ Source "${source}" tidak tersedia. Pilih: qobuz, tidal, spotify, soundcloud, deezer`);
    }
    
    // Show typing indicator
    await ctx.reply(`⬇️ Sedang mengunduh dari ${source}...`);
    
    try {
      // Do a quick search to get track results from this source
      const results = await this.verdana.search('test', 5);
      const sourceResults = results[selectedSourceKey] || [];
      
      if (!sourceResults || sourceResults.length === 0) {
        return await ctx.reply(`❌ Tidak ada track dari source ${source}`);
      }
      
      const trackNum = parseInt(trackNumber);
      if (isNaN(trackNum) || trackNum < 1 || trackNum > sourceResults.length) {
        return await ctx.reply(`❌ Nomor track tidak valid. Pilih 1-${sourceResults.length}`);
      }
      
      const selectedTrack = sourceResults[trackNum - 1];
      
      // Get available formats from the source module
      const formats = this.verdana.modules[selectedSourceKey].getFormats
        ? await this.verdana.modules[selectedSourceKey].getFormats(selectedTrack)
        : [];
      
      if (formats.length === 0) {
        return await ctx.reply('❌ Format tidak tersedia untuk track ini');
      }
      
      // Show format selection
      let formatMenu = `📀 *${selectedTrack.title}* - ${selectedTrack.artists ? selectedTrack.artists.map(a => a.name).join(', ') : 'Unknown'}\n\n`;
      formatMenu += `📁 Source: ${source.toUpperCase()}\n\n`;
      formatMenu += 'Pilih format download:\n';
      
      for (let i = 0; i < formats.length; i++) {
        const fmt = formats[i];
        const sizeMB = (fmt.sizeBytes / 1024 / 1024).toFixed(2);
        formatMenu += `   ${i + 1}. ${fmt.name} ${fmt.extension || ''} (${sizeMB} MB)\n`;
      }
      
      formatMenu += `\nKirim nomor format (1-${formats.length}) untuk memulai download!`;
      
      // Store download session in ctx
      ctx.session = ctx.session || {};
      ctx.session.currentDownload = {
        track: selectedTrack,
        source: selectedSourceKey,
        trackNumber: trackNum,
        results: sourceResults,
        formats: formats
      };
      
      await ctx.reply(formatMenu, { parse_mode: 'Markdown' });
      
    } catch (error) {
      const logger = createLogger('VerdanaModule');
      logger.error('Download error:', error);
      await ctx.reply(`❌ Error saat download: ${error.message.substring(0, 300)}`);
    }
  }

  async handleFormatSelection(ctx) {
    const userId = ctx.from?.id;
    const args = ctx.text?.split(' ') || [];
    const formatNumber = args[0];
    
    if (!formatNumber) {
      return await ctx.reply('❌ Kirim nomor format!');
    }
    
    const formatIdx = parseInt(formatNumber);
    if (isNaN(formatIdx) || formatIdx < 1) {
      return await ctx.reply('❌ Nomor format tidak valid!');
    }
    
    // Get stored download session
    const session = ctx.session && ctx.session.currentDownload;
    if (!session || !session.formats) {
      return await ctx.reply('❌ Session download expired. Gunakan /download lagi.');
    }
    
    const format = session.formats[formatIdx - 1];
    if (!format) {
      return await ctx.reply(`❌ Format ${formatNumber} tidak valid. Pilih 1-${session.formats.length}`);
    }
    
    await ctx.reply(`⬇️ Memulai download ${format.name}...`);
    
    try {
      // Get the track and source
      const track = session.track;
      const source = session.source;
      
      // Get stream based on format
      const streamInfo = await track.getStream(formatIdx - 1); // 0-indexed
      
      // Create file in temp directory
      const tempDir = path.join('./temp', `${userId}-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });
      const filePath = path.join(tempDir, `${track.id}.${streamInfo.extension}`);
      
      const fileStream = fs.createWriteStream(filePath);
      const reader = streamInfo.stream.getReader();
      
      // Pipe data chunks to file
      let totalBytes = 0;
      
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        fileStream.write(value);
        totalBytes += value.length;
      }
      
      await new Promise((resolve) => fileStream.end(resolve));
      
      // Send file to user
      await ctx.replyWithDocument({
        document: fs.createReadStream(filePath),
        filename: `${track.title}.${streamInfo.extension}`,
        caption: `🎵 *${track.title}* - ${track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown'}\n\n📁 Format: ${format.name}${format.extension || ''}\n📊 Size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`
      }, { parse_mode: 'Markdown' });
      
      // Clean up temp file
      try { fs.rmSync(tempDir, { recursive: true }); } catch {}
      
      // Clear session
      delete ctx.session.currentDownload;
      
    } catch (error) {
      const logger = createLogger('VerdanaModule');
      logger.error('Format selection error:', error);
      await ctx.reply(`❌ Error: ${error.message.substring(0, 200)}`);
    }
  }
}

export default VerdanaModule;