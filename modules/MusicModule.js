import BaseModule from './BaseModule.js';
import { Markup } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MusicModule extends BaseModule {
  constructor() {
    super();
    this.name = 'music';
    this.description = 'Modul untuk download musik dari Monochrome';
    this.version = '1.0.0';
    this.author = 'Bot Developer';
    this.commands = [
      { command: 'music', description: '🎵 Search & download music', adminOnly: false, rateLimit: true },
      { command: 'search', description: '🔍 Search music', adminOnly: false, rateLimit: true },
      { command: 'download', description: '⬇️ Download music by ID', adminOnly: false, rateLimit: true }
    ];
    
    this.searchCache = new Map();
    this.downloadCache = new Map();
    
    this.downloadSemaphore = 0;
    this.maxConcurrentDownloads = 2;
    this.uploadSemaphore = 0;
    this.maxConcurrentUploads = 1;
    
    this.downloadQueue = [];
    this.uploadQueue = [];
    
    this.config = {
      maxResults: 10,
      downloadTimeout: 300000,
      maxFileSize: 50 * 1024 * 1024,
      tempDir: null,
      apiBaseUrl: 'https://tracks.monochrome.st',
      searchEndpoint: '/api/v1/search',
      trackEndpoint: '/api/v1/track',
      downloadEndpoint: '/api/v1/download'
    };
  }

  async init(bot, config) {
    const moduleDefaultConfig = { ...this.config };
    
    await super.init(bot, config);
    
    this.config = { ...config, ...moduleDefaultConfig };
    
    this.config.tempDir = path.join(__dirname, '..', 'temp');
    
    if (!fs.existsSync(this.config.tempDir)) {
      fs.mkdirSync(this.config.tempDir, { recursive: true });
    }
    
    setInterval(() => this.cleanupTempFiles(), 10 * 60 * 1000);
    
    this.logger.info({ tempDir: this.config.tempDir }, 'Music module initialized');
    this.logger.info({ apiBaseUrl: this.config.apiBaseUrl }, 'API config');
    this.logger.info({ 
      maxConcurrentDownloads: this.maxConcurrentDownloads, 
      maxConcurrentUploads: this.maxConcurrentUploads 
    }, 'Concurrency limits');
  }

  async acquireDownloadSemaphore(ctx) {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (this.downloadSemaphore < this.maxConcurrentDownloads) {
          this.downloadSemaphore++;
          this.logger.debug({ active: this.downloadSemaphore, max: this.maxConcurrentDownloads }, 'Download semaphore acquired');
          resolve();
        } else {
          this.downloadQueue.push({ ctx, resolve });
          this.logger.debug({ queueLength: this.downloadQueue.length }, 'Download queued');
          
          if (ctx) {
            ctx.reply(`⏳ Server sibuk, Anda dalam antrian posisi ${this.downloadQueue.length}. Silakan tunggu...`)
              .catch(() => {});
          }
        }
      };
      tryAcquire();
    });
  }

  releaseDownloadSemaphore() {
    this.downloadSemaphore--;
    this.logger.debug({ active: this.downloadSemaphore, max: this.maxConcurrentDownloads }, 'Download semaphore released');
    
    if (this.downloadQueue.length > 0) {
      const next = this.downloadQueue.shift();
      this.downloadSemaphore++;
      this.logger.debug({ active: this.downloadSemaphore, max: this.maxConcurrentDownloads }, 'Processing queued download');
      next.resolve();
    }
  }

  async acquireUploadSemaphore(ctx) {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (this.uploadSemaphore < this.maxConcurrentUploads) {
          this.uploadSemaphore++;
          this.logger.debug({ active: this.uploadSemaphore, max: this.maxConcurrentUploads }, 'Upload semaphore acquired');
          resolve();
        } else {
          this.uploadQueue.push({ ctx, resolve });
          this.logger.debug({ queueLength: this.uploadQueue.length }, 'Upload queued');
          
          if (ctx) {
            ctx.reply(`⏳ Upload antrian posisi ${this.uploadQueue.length}. Silakan tunggu...`)
              .catch(() => {});
          }
        }
      };
      tryAcquire();
    });
  }

  releaseUploadSemaphore() {
    this.uploadSemaphore--;
    this.logger.debug({ active: this.uploadSemaphore, max: this.maxConcurrentUploads }, 'Upload semaphore released');
    
    if (this.uploadQueue.length > 0) {
      const next = this.uploadQueue.shift();
      this.uploadSemaphore++;
      this.logger.debug({ active: this.uploadSemaphore, max: this.maxConcurrentUploads }, 'Processing queued upload');
      next.resolve();
    }
  }

  registerHandlers() {
    this.rateLimitedCommand('music', '🎵 Search & download music', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1).join(' ');
      if (!args) {
        return ctx.reply(
          '🎵 *Music Downloader*\n\n' +
          'Gunakan: `/music <judul lagu/artis>`\n' +
          'Contoh: `/music The Weeknd Blinding Lights`\n\n' +
          'Atau gunakan command terpisah:\n' +
          '• `/search <query>` - Cari musik\n' +
          '• `/download <track_id>` - Download by ID',
          { parse_mode: 'Markdown' }
        );
      }
      await this.handleSearch(ctx, args);
    });

    this.rateLimitedCommand('search', '🔍 Search music', async (ctx) => {
      const query = ctx.message.text.split(' ').slice(1).join(' ');
      if (!query) {
        return ctx.reply('Gunakan: `/search <judul lagu/artis>`', { parse_mode: 'Markdown' });
      }
      await this.handleSearch(ctx, query);
    });

    this.rateLimitedCommand('download', '⬇️ Download music by ID', async (ctx) => {
      const trackId = ctx.message.text.split(' ')[1];
      if (!trackId) {
        return ctx.reply('Gunakan: `/download <track_id>`', { parse_mode: 'Markdown' });
      }
      await this.handleDownload(ctx, trackId);
    });

    this.bot.action(/^music_select_(.+)$/, async (ctx) => {
      const trackId = ctx.match[1];
      await ctx.answerCbQuery('⬇️ Memulai download...');
      await this.handleDownload(ctx, trackId);
    });

    this.bot.action(/^music_page_(.+)_(.+)$/, async (ctx) => {
      const [query, page] = [ctx.match[1], parseInt(ctx.match[2])];
      await ctx.answerCbQuery();
      await this.showSearchResults(ctx, query, page, true);
    });

    this.bot.action(/^music_cancel$/, async (ctx) => {
      await ctx.answerCbQuery('❌ Dibatalkan');
      await ctx.editMessageText('❌ Pencarian dibatalkan.');
    });

    this.bot.hears(/^(music|lagu|download musik)$/i, async (ctx) => {
      await ctx.reply(
        '🎵 *Music Downloader*\n\n' +
        'Kirim perintah:\n' +
        '`/music <judul lagu>` - Cari & download\n' +
        '`/search <query>` - Hanya cari\n' +
        '`/download <id>` - Download by ID',
        { parse_mode: 'Markdown' }
      );
    });
  }

  async handleSearch(ctx, query) {
    const userId = ctx.from.id;
    
    if (!query || query.trim() === '') {
      return ctx.reply(
        '🎵 *Music Downloader*\n\n' +
        'Gunakan: `/music <judul lagu/artis>`\n' +
        'Contoh: `/music The Weeknd Blinding Lights`\n\n' +
        'Atau gunakan command terpisah:\n' +
        '• `/search <query>` - Cari musik\n' +
        '• `/download <track_id>` - Download by ID',
        { parse_mode: 'Markdown' }
      );
    }
    
    const message = await ctx.reply('🔍 Mencari musik...', { parse_mode: 'Markdown' });
    
    try {
      const results = await this.searchTracks(query);
      
      if (!results || results.length === 0) {
        await ctx.telegram.editMessageText(
          ctx.chat.id, message.message_id, null,
          `🔍 Tidak ditemukan hasil untuk: "${query}"`
        );
        return;
      }
      
      this.searchCache.set(userId, { query, results, page: 0, timestamp: Date.now() });
      
      await this.showSearchResults(ctx, query, 0, false, message.message_id);
      
    } catch (error) {
      this.logger.error({ err: error, query }, 'Search error');
      await ctx.telegram.editMessageText(
        ctx.chat.id, message.message_id, null,
        `❌ Error saat mencari: ${error.message}`
      );
    }
  }

  async searchTracks(query) {
    this.logger.info({ query }, 'Searching for tracks');
    
    try {
      const baseUrl = this.config.monochromeApiBaseUrl || this.config.apiBaseUrl;
      const url = `${baseUrl}/search?q=${encodeURIComponent(query)}`;
      
      this.logger.debug({ url }, 'Trying search');
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
      });
      
      this.logger.debug({ status: response.status }, 'Search response');
      
      const data = response.data;
      const results = [];
      
      const releaseMap = new Map();
      if (data.releases && Array.isArray(data.releases)) {
        for (const release of data.releases) {
          const key = release.releaseId || release.id;
          if (key) releaseMap.set(key, release);
        }
      }
      
      if (data.tracks && Array.isArray(data.tracks)) {
        for (const track of data.tracks) {
          const artistName = track.artistNames?.[0] || track.artists?.[0]?.name || 'Unknown Artist';
          
          let albumTitle = 'Unknown Album';
          let albumArtwork = track.artwork;
          let releaseDate = track.releaseDate;
          
          const releaseKey = track.releaseId;
          if (releaseKey && releaseMap.has(releaseKey)) {
            const release = releaseMap.get(releaseKey);
            albumTitle = release.title || albumTitle;
            albumArtwork = release.artwork || albumArtwork;
            releaseDate = release.releaseDate || releaseDate;
          }
          
          results.push({
            id: track.id || track.trackId,
            title: track.title || 'Unknown',
            artist: artistName,
            album: albumTitle,
            duration: track.duration ? Math.round(track.duration / 1000) : 0,
            cover: albumArtwork,
            year: releaseDate ? new Date(releaseDate).getFullYear() : null,
            explicit: track.explicit || false,
            quality: 'FLAC',
            isrc: track.isrc,
            playable: track.playable
          });
        }
      }
      
      this.logger.info({ count: results.length }, 'Found tracks');
      return results;
      
    } catch (error) {
      this.logger.error({ err: error, query }, 'Search API error');
      throw error;
    }
  }

  formatSearchResults(items) {
    return items
      .filter(item => item && item.id && item.title)
      .slice(0, this.config.maxResults)
      .map((item, index) => ({
        id: item.id,
        title: item.title || item.name || 'Unknown',
        artist: item.artist?.name || item.artists?.[0]?.name || item.artist || 'Unknown Artist',
        album: item.album?.title || item.album || 'Unknown Album',
        duration: item.duration || 0,
        cover: item.album?.cover || item.cover || item.album?.image || null,
        year: item.album?.releaseDate ? new Date(item.album.releaseDate).getFullYear() : null,
        explicit: item.explicit || false,
        quality: item.quality || 'FLAC'
      }));
  }

  async showSearchResults(ctx, query, page, isEdit = false, messageId = null) {
    const userId = ctx.from.id;
    let cache = this.searchCache.get(userId);
    
    if (!cache || cache.query !== query) {
      const results = await this.searchTracks(query);
      if (!results || results.length === 0) {
        const text = `🔍 Tidak ditemukan hasil untuk: "${query}"`;
        if (isEdit && messageId) {
          await ctx.telegram.editMessageText(ctx.chat.id, messageId, null, text);
        } else {
          await ctx.reply(text);
        }
        return;
      }
      // Ensure cache object exists
      if (!cache) {
        cache = { query, results: [], page: 0, timestamp: Date.now() };
        this.searchCache.set(userId, cache);
      }
      cache.results = results;
      cache.query = query;
      cache.page = page;
    }
    
    const results = cache.results;
    const itemsPerPage = 5;
    const totalPages = Math.ceil(results.length / itemsPerPage);
    const start = page * itemsPerPage;
    const end = Math.min(start + itemsPerPage, results.length);
    const pageResults = results.slice(start, end);
    
    let text = `🔍 *Hasil pencarian: "${query}"*\n`;
    text += `📄 Halaman ${page + 1} dari ${totalPages} (${results.length} hasil)\n\n`;
    
    const buttons = [];
    
    pageResults.forEach((track, index) => {
      const globalIndex = start + index + 1;
      const duration = this.formatDuration(track.duration);
      const explicit = track.explicit ? ' 🅴' : '';
      text += `${globalIndex}. **${track.title}**${explicit}\n`;
      text += `   👤 ${track.artist} • 💿 ${track.album} • ⏱ ${duration} • 🎧 ${track.quality}\n\n`;
      
      buttons.push([Markup.button.callback(
        `${globalIndex}. ${track.title} - ${track.artist}`,
        `music_select_${track.id}`
      )]);
    });
    
    const navButtons = [];
    if (page > 0) {
      navButtons.push(Markup.button.callback('⬅️ Prev', `music_page_${query}_${page - 1}`));
    }
    navButtons.push(Markup.button.callback(`📄 ${page + 1}/${totalPages}`, 'music_noop'));
    if (page < totalPages - 1) {
      navButtons.push(Markup.button.callback('Next ➡️', `music_page_${query}_${page + 1}`));
    }
    buttons.push(navButtons);
    buttons.push([Markup.button.callback('❌ Batal', 'music_cancel')]);
    
    const keyboard = Markup.inlineKeyboard(buttons);
    
    if (isEdit && messageId) {
      await ctx.telegram.editMessageText(
        ctx.chat.id, messageId, null, text,
        { parse_mode: 'Markdown', ...keyboard }
      );
    } else {
      await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
    }
  }

  async handleDownload(ctx, trackId) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    
    const cache = this.searchCache.get(userId);
    let trackInfo = null;
    
    if (cache) {
      trackInfo = cache.results.find(t => t.id === trackId);
    }
    
    if (!trackInfo) {
      trackInfo = await this.getTrackInfo(trackId);
    }
    
    if (!trackInfo) {
      return ctx.reply('❌ Track tidak ditemukan. Coba search dulu dengan `/music <query>`.', { parse_mode: 'Markdown' });
    }
    
    await this.acquireDownloadSemaphore(ctx);
    
    const progressMsg = await ctx.reply(
      `⬇️ *Downloading...*\n\n` +
      `🎵 **${trackInfo.title}**\n` +
      `👤 ${trackInfo.artist}\n` +
      `💿 ${trackInfo.album}\n\n` +
      `⏳ Menyiapkan download...`,
      { parse_mode: 'Markdown' }
    );
    
    let filePath = null;
    let downloadId = null;
    
    if (this.db) {
      downloadId = this.db.downloadHistory.insert(
        String(userId), trackId, trackInfo.title, trackInfo.artist, trackInfo.album,
        0, trackInfo.duration, trackInfo.quality, 'queued'
      );
    }
    
    try {
      filePath = await this.downloadTrack(trackId, trackInfo, (progress) => {
        if (progress.percent % 10 === 0) {
          ctx.telegram.editMessageText(
            chatId, progressMsg.message_id, null,
            `⬇️ *Downloading...*\n\n` +
            `🎵 **${trackInfo.title}**\n` +
            `👤 ${trackInfo.artist}\n\n` +
            `📥 ${progress.percent}% (${this.formatBytes(progress.downloaded)}/${this.formatBytes(progress.total)})`,
            { parse_mode: 'Markdown' }
          ).catch(() => {});
        }
      });
      
      if (this.db) {
        this.db.downloadHistory.update(downloadId, 'downloading', 0, 0, null);
      }
      
      const stats = fs.statSync(filePath);
      this.logger.info({ filePath, size: stats.size }, 'Uploading file');
      
      if (stats.size < 5000) {
        throw new Error(`File terlalu kecil: ${stats.size} bytes`);
      }
      
      await ctx.telegram.editMessageText(
        chatId, progressMsg.message_id, null,
        `⬆️ *Uploading ke Telegram...*\n\n` +
        `🎵 **${trackInfo.title}**\n` +
        `👤 ${trackInfo.artist}\n` +
        `📦 ${this.formatBytes(stats.size)}`,
        { parse_mode: 'Markdown' }
      );
      
      await this.acquireUploadSemaphore(ctx);
      
      let uploadSuccess = false;
      let lastError = null;
      const maxRetries = 3;
      
      try {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const fileStream = fs.createReadStream(filePath);
            
            await ctx.replyWithAudio(
              { source: fileStream },
              {
                title: trackInfo.title,
                performer: trackInfo.artist,
                caption: `🎵 ${trackInfo.title} - ${trackInfo.artist}\n💿 ${trackInfo.album}\n🎧 ${trackInfo.quality || 'FLAC'} (${this.formatBytes(stats.size)})\n\n🤖 Downloaded via @${ctx.botInfo?.username || 'bot'}`,
                parse_mode: 'Markdown'
              }
            );
            
            uploadSuccess = true;
            break;
          } catch (uploadError) {
            lastError = uploadError;
            this.logger.error({ err: uploadError, attempt, maxRetries }, 'Upload attempt failed');
            
            if (attempt < maxRetries) {
              const waitTime = attempt * 2000;
              await ctx.telegram.editMessageText(
                chatId, progressMsg.message_id, null,
                `⬆️ *Upload ke Telegram... (Percobaan ${attempt + 1}/${maxRetries})*\n\n` +
                `🎵 **${trackInfo.title}**\n` +
                `👤 ${trackInfo.artist}\n` +
                `📦 ${this.formatBytes(stats.size)}\n\n` +
                `⚠️ Network issue, mencoba lagi dalam ${waitTime/1000}s...`,
                { parse_mode: 'Markdown' }
              );
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }
          }
        }
      } finally {
        this.releaseUploadSemaphore();
      }
      
      if (!uploadSuccess) {
        throw lastError || new Error('Upload gagal setelah ' + maxRetries + ' percobaan');
      }
      
      await ctx.telegram.deleteMessage(chatId, progressMsg.message_id);
      
      this.deleteTempFile(filePath);
      
      if (this.db) {
        this.db.downloadHistory.update(downloadId, 'success', stats.size, trackInfo.duration, null);
        this.db.users.incrementDownloads(String(userId));
      }
      
      this.logger.info({ userId, trackId, title: trackInfo.title }, 'Download completed successfully');
      
    } catch (error) {
      this.logger.error({ err: error, userId, trackId }, 'Download error');
      
      let errorMsg = error.message;
      if (errorMsg.includes('autentikasi') || errorMsg.includes('authentication') || errorMsg.includes('cookies')) {
        errorMsg = '🔐 *Monochrome API Memerlukan Autentikasi*\n\n' +
          'Maaf, download dari Monochrome memerlukan login/cookies yang tidak tersedia di bot publik ini.\n\n' +
          '💡 *Solusi:*\n' +
          '• Gunakan website Monochrome langsung: https://monochrome.st\n' +
          '• Atau gunakan aplikasi desktop Monochrome\n' +
          '• Bot ini hanya bisa search (jika API public tersedia)';
      } else if (errorMsg.includes('socket hang up') || errorMsg.includes('ECONNRESET') || errorMsg.includes('timeout')) {
        errorMsg = '🌐 *Network Error saat Upload ke Telegram*\n\n' +
          `File sudah didownload (${this.formatBytes(stats?.size || 0)}) tapi gagal upload ke Telegram.\n` +
          'Ini biasanya karena koneksi tidak stabil atau file terlalu besar.\n\n' +
          '💡 *Solusi:*\n' +
          '• Coba lagi nanti\n' +
          '• Atau gunakan website Monochrome langsung\n' +
          '• File tersedia di server bot (temp), hubungi admin jika perlu';
      }
      
      await ctx.telegram.editMessageText(
        chatId, progressMsg.message_id, null,
        `❌ *Download gagal*\n\n` +
        `🎵 ${trackInfo.title} - ${trackInfo.artist}\n\n` +
        errorMsg,
        { parse_mode: 'Markdown' }
      );
      
      if (this.db) {
        this.db.downloadHistory.update(downloadId, 'failed', stats?.size || 0, trackInfo.duration, error.message);
      }
      
    } finally {
      this.releaseDownloadSemaphore();
    }
  }

  async getTrackInfo(trackId) {
    try {
      const baseUrl = this.config.monochromeApiBaseUrl || this.config.apiBaseUrl;
      const trackEndpoint = this.config.monochromeTrackEndpoint || this.config.trackEndpoint;
      
      const url = `${baseUrl}${trackEndpoint}/${trackId}`;
      
      this.logger.debug({ url }, 'Getting track info');
      const response = await axios.get(url, {
        headers: { 'Accept': 'application/json' },
        timeout: 10000
      });
      
      if (response.data) {
        return this.formatSearchResults([response.data])[0];
      }
    } catch (error) {
      this.logger.error({ err: error, trackId }, 'Get track info error');
    }
    return null;
  }

  async downloadTrack(trackId, trackInfo, onProgress) {
    const fileName = this.sanitizeFileName(`${trackInfo.artist} - ${trackInfo.title}.flac`);
    const filePath = path.join(this.config.tempDir, fileName);
    
    const baseUrl = this.config.monochromeApiBaseUrl || this.config.apiBaseUrl;
    const downloadEndpoint = this.config.monochromeDownloadEndpoint || this.config.downloadEndpoint;
    
    const downloadUrls = [
      `${baseUrl}${downloadEndpoint}/${trackId}`,
      `${baseUrl}/download/${trackId}`,
      `${baseUrl}/api/download/${trackId}`
    ];
    
    for (const url of downloadUrls) {
      try {
        this.logger.debug({ url }, 'Trying download');
        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'stream',
          headers: {
            'Accept': 'audio/flac,audio/*;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: this.config.downloadTimeout,
          onDownloadProgress: (progressEvent) => {
            if (onProgress && progressEvent.total) {
              onProgress({
                percent: Math.round((progressEvent.loaded / progressEvent.total) * 100),
                downloaded: progressEvent.loaded,
                total: progressEvent.total
              });
            }
          }
        });
        
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        
        const stats = fs.statSync(filePath);
        if (stats.size > this.config.maxFileSize) {
          this.deleteTempFile(filePath);
          throw new Error(`File terlalu besar: ${this.formatBytes(stats.size)} (max: ${this.formatBytes(this.config.maxFileSize)})`);
        }
        
        if (stats.size < 1024) {
          this.deleteTempFile(filePath);
          throw new Error('File terlalu kecil, kemungkinan error');
        }
        
        this.logger.info({ url, size: stats.size }, 'Downloaded successfully');
        return filePath;
        
      } catch (error) {
        this.logger.error({ err: error, url }, 'Download failed');
        if (fs.existsSync(filePath)) this.deleteTempFile(filePath);
        continue;
      }
    }
    
    throw new Error(`Semua endpoint download gagal untuk track: ${trackId}. Monochrome API memerlukan autentikasi/cookies yang tidak tersedia di bot ini.`);
  }

  deleteTempFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        this.logger.debug({ filePath }, 'Deleted temp file');
      }
    } catch (error) {
      this.logger.error({ err: error, filePath }, 'Error deleting temp file');
    }
  }

  cleanupTempFiles() {
    try {
      const files = fs.readdirSync(this.config.tempDir);
      const now = Date.now();
      const maxAge = 60 * 60 * 1000;
      
      files.forEach(file => {
        const filePath = path.join(this.config.tempDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAge) {
          this.deleteTempFile(filePath);
        }
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Cleanup error');
    }
  }

  formatDuration(seconds) {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  sanitizeFileName(name) {
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200);
  }
}

export default MusicModule;