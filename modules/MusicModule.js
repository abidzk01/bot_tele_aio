const BaseModule = require('./BaseModule');
const { Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

class MusicModule extends BaseModule {
  constructor() {
    super();
    this.name = 'music';
    this.description = 'Modul untuk download musik dari Monochrome';
    this.version = '1.0.0';
    this.author = 'Bot Developer';
    this.commands = [
      { command: 'music', description: '🎵 Search & download music', adminOnly: false },
      { command: 'search', description: '🔍 Search music', adminOnly: false },
      { command: 'download', description: '⬇️ Download music by ID', adminOnly: false }
    ];
    
    // Cache untuk menyimpan hasil search per user
    this.searchCache = new Map();
    // Cache untuk menyimpan download progress
    this.downloadCache = new Map();
    
    // Konfigurasi - akan di-merge dengan global config di init()
    this.config = {
      maxResults: 10,
      downloadTimeout: 300000, // 5 menit
      maxFileSize: 50 * 1024 * 1024, // 50MB
      tempDir: null,
      apiBaseUrl: 'https://tracks.monochrome.st',
      searchEndpoint: '/api/v1/search',
      trackEndpoint: '/api/v1/track',
      downloadEndpoint: '/api/v1/download'
    };
  }

  async init(bot, config) {
    // Simpan module DEFAULT config SEBELUM super.init() overwrite
    const moduleDefaultConfig = { ...this.config };
    
    await super.init(bot, config);
    
    // Merge: global config + module defaults (module defaults take precedence for module-specific keys)
    this.config = { ...config, ...moduleDefaultConfig };
    
    // Setup temp directory
    this.config.tempDir = path.join(__dirname, '..', 'temp');
    
    // Setup ffmpeg path
    if (ffmpegStatic) {
      ffmpeg.setFfmpegPath(ffmpegStatic);
    }
    
    // Buat temp directory
    if (!fs.existsSync(this.config.tempDir)) {
      fs.mkdirSync(this.config.tempDir, { recursive: true });
    }
    
    // Cleanup temp files lama (> 1 jam) setiap 10 menit
    setInterval(() => this.cleanupTempFiles(), 10 * 60 * 1000);
    
    console.log(`[${this.name}] Music module initialized with temp dir: ${this.config.tempDir}`);
    console.log(`[${this.name}] API Base URL: ${this.config.apiBaseUrl}`);
  }

  registerHandlers() {
    // Command /music - utama
    this.bot.command('music', async (ctx) => {
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

    // Command /search
    this.bot.command('search', async (ctx) => {
      const query = ctx.message.text.split(' ').slice(1).join(' ');
      if (!query) {
        return ctx.reply('Gunakan: `/search <judul lagu/artis>`', { parse_mode: 'Markdown' });
      }
      await this.handleSearch(ctx, query);
    });

    // Command /download
    this.bot.command('download', async (ctx) => {
      const trackId = ctx.message.text.split(' ')[1];
      if (!trackId) {
        return ctx.reply('Gunakan: `/download <track_id>`', { parse_mode: 'Markdown' });
      }
      await this.handleDownload(ctx, trackId);
    });

    // Callback query untuk inline keyboard
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

    // Handle text "music" atau "lagu" untuk quick access
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

  /**
   * Handle search command
   */
  async handleSearch(ctx, query) {
    const userId = ctx.from.id;
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
      
      // Simpan ke cache
      this.searchCache.set(userId, { query, results, page: 0, timestamp: Date.now() });
      
      // Tampilkan hasil pertama
      await this.showSearchResults(ctx, query, 0, false, message.message_id);
      
    } catch (error) {
      console.error('[MusicModule] Search error:', error);
      await ctx.telegram.editMessageText(
        ctx.chat.id, message.message_id, null,
        `❌ Error saat mencari: ${error.message}`
      );
    }
  }

  /**
   * Search tracks dari Monochrome API
   * Endpoint: GET https://tracks.monochrome.st/search?q={query}
   * Returns: { tracks, releases, artists, users, playlists }
   */
  async searchTracks(query) {
    console.log(`[MusicModule] Searching for: "${query}"`);
    
    try {
      const baseUrl = this.config.monochromeApiBaseUrl || this.config.apiBaseUrl;
      const url = `${baseUrl}/search?q=${encodeURIComponent(query)}`;
      
      console.log(`[MusicModule] Trying search: ${url}`);
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 15000
      });
      
      console.log(`[MusicModule] Response status: ${response.status}`);
      
      const data = response.data;
      const results = [];
      
      // Build release lookup map (both releaseId and id)
      const releaseMap = new Map();
      if (data.releases && Array.isArray(data.releases)) {
        for (const release of data.releases) {
          const key = release.releaseId || release.id;
          if (key) releaseMap.set(key, release);
        }
      }
      
      // Parse tracks dari response
      if (data.tracks && Array.isArray(data.tracks)) {
        for (const track of data.tracks) {
          // Get artist name
          const artistName = track.artistNames?.[0] || track.artists?.[0]?.name || 'Unknown Artist';
          
          // Get album/release info
          let albumTitle = 'Unknown Album';
          let albumArtwork = track.artwork;
          let releaseDate = track.releaseDate;
          
          // Try to match release by releaseId or track.releaseId
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
            duration: track.duration ? Math.round(track.duration / 1000) : 0, // duration in ms -> seconds
            cover: albumArtwork,
            year: releaseDate ? new Date(releaseDate).getFullYear() : null,
            explicit: track.explicit || false,
            quality: 'FLAC', // Monochrome provides FLAC
            isrc: track.isrc,
            playable: track.playable
          });
        }
      }
      
      console.log(`[MusicModule] Found ${results.length} tracks`);
      return results;
      
    } catch (error) {
      console.error('[MusicModule] Search API error:', error.message);
      throw error;
    }
  }

  /**
   * Format search results dari API (fallback untuk data lama)
   */
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

  /**
   * Mock search results untuk demo/testing (fallback jika API error)
   * Termasuk lagu Indonesia populer
   */
  getMockSearchResults(query) {
    const mockData = [
      // Indonesian songs
      { id: 'mock_1', title: 'Ada Apa Denganmu', artist: 'Peterpan', album: 'Taman Langit', duration: 255, year: 2003, quality: 'FLAC' },
      { id: 'mock_2', title: 'Menunggumu', artist: 'Peterpan', album: 'Taman Langit', duration: 287, year: 2003, quality: 'FLAC' },
      { id: 'mock_3', title: 'Mimpi Yang Sempurna', artist: 'Peterpan', album: 'Bintang Di Surga', duration: 268, year: 2004, quality: 'FLAC' },
      { id: 'mock_4', title: 'Aku & Bintang', artist: 'Peterpan', album: 'Bintang Di Surga', duration: 298, year: 2004, quality: 'FLAC' },
      { id: 'mock_5', title: 'Hari Yang Cerah', artist: 'Peterpan', album: 'Hari Yang Cerah', duration: 234, year: 2007, quality: 'FLAC' },
      { id: 'mock_6', title: 'Cobalah Mengerti', artist: 'Noah', album: 'Second Chance', duration: 278, year: 2014, quality: 'FLAC' },
      { id: 'mock_7', title: 'Separuh Aku', artist: 'Noah', album: 'Second Chance', duration: 267, year: 2014, quality: 'FLAC' },
      { id: 'mock_8', title: 'Jangan Pergi', artist: 'Dewa 19', album: 'Bintang Lima', duration: 289, year: 2000, quality: 'FLAC' },
      { id: 'mock_9', title: 'Kangen', artist: 'Dewa 19', album: 'Bintang Lima', duration: 312, year: 2000, quality: 'FLAC' },
      { id: 'mock_10', title: 'Roman Picisan', artist: 'Dewa 19', album: 'Cintailah Cinta', duration: 276, year: 2002, quality: 'FLAC' },
      { id: 'mock_11', title: 'Seperti Yang Kau Minta', artist: 'Chrisye', album: 'Dekade', duration: 298, year: 2002, quality: 'FLAC' },
      { id: 'mock_12', title: 'Kala Cinta Menggoda', artist: 'Chrisye', album: 'Kala Cinta Menggoda', duration: 305, year: 1997, quality: 'FLAC' },
      { id: 'mock_13', title: 'Laskar Pelangi', artist: 'Nidji', album: 'Laskar Pelangi OST', duration: 234, year: 2008, quality: 'FLAC' },
      { id: 'mock_14', title: 'Hapus Aku', artist: 'Nidji', album: 'Top Up', duration: 267, year: 2007, quality: 'FLAC' },
      { id: 'mock_15', title: 'Kau Adalah', artist: 'Isyana Sarasvati', album: 'Paradox', duration: 223, year: 2017, quality: 'FLAC' },
      { id: 'mock_16', title: '1 2 3', artist: 'Tulus', album: 'Monokrom', duration: 234, year: 2014, quality: 'FLAC' },
      { id: 'mock_17', title: 'Pamit', artist: 'Tulus', album: 'Monokrom', duration: 289, year: 2014, quality: 'FLAC' },
      { id: 'mock_18', title: 'Sewaktu Denganku', artist: 'Tulus', album: 'Gajah', duration: 256, year: 2012, quality: 'FLAC' },
      { id: 'mock_19', title: 'Terlalu Lama', artist: 'Raisa', album: 'Raisa', duration: 278, year: 2011, quality: 'FLAC' },
      { id: 'mock_20', title: 'Could It Be', artist: 'Raisa', album: 'Heart To Heart', duration: 267, year: 2017, quality: 'FLAC' },
      // International songs
      { id: 'mock_21', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 200, year: 2020, quality: 'FLAC' },
      { id: 'mock_22', title: 'Shape of You', artist: 'Ed Sheeran', album: '÷', duration: 233, year: 2017, quality: 'FLAC' },
      { id: 'mock_23', title: 'Levitating', artist: 'Dua Lipa', album: 'Future Nostalgia', duration: 203, year: 2020, quality: 'FLAC' },
      { id: 'mock_24', title: 'Bad Guy', artist: 'Billie Eilish', album: 'WHEN WE ALL FALL ASLEEP', duration: 194, year: 2019, quality: 'FLAC' },
      { id: 'mock_25', title: 'Watermelon Sugar', artist: 'Harry Styles', album: 'Fine Line', duration: 174, year: 2019, quality: 'FLAC' }
    ].map((item, i) => ({ ...item, id: `mock_${i+1}_${Date.now()}` }));
    
    return mockData.filter(item =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.artist.toLowerCase().includes(query.toLowerCase()) ||
      item.album.toLowerCase().includes(query.toLowerCase())
    );
  }

  /**
   * Tampilkan hasil search dengan inline keyboard
   */
  async showSearchResults(ctx, query, page, isEdit = false, messageId = null) {
    const userId = ctx.from.id;
    const cache = this.searchCache.get(userId);
    
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
    
    // Build message
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
    
    // Navigation buttons
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

  /**
   * Handle download track
   */
  async handleDownload(ctx, trackId) {
    const userId = ctx.from.id;
    const chatId = ctx.chat.id;
    
    // Cek apakah trackId dari cache
    const cache = this.searchCache.get(userId);
    let trackInfo = null;
    
    if (cache) {
      trackInfo = cache.results.find(t => t.id === trackId);
    }
    
    if (!trackInfo) {
      // Coba fetch info track
      trackInfo = await this.getTrackInfo(trackId);
    }
    
    if (!trackInfo) {
      return ctx.reply('❌ Track tidak ditemukan. Coba search dulu dengan `/music <query>`.', { parse_mode: 'Markdown' });
    }
    
    // Kirim pesan progress
    const progressMsg = await ctx.reply(
      `⬇️ *Downloading...*\n\n` +
      `🎵 **${trackInfo.title}**\n` +
      `👤 ${trackInfo.artist}\n` +
      `💿 ${trackInfo.album}\n\n` +
      `⏳ Menyiapkan download...`,
      { parse_mode: 'Markdown' }
    );
    
    try {
      // Download file
      const filePath = await this.downloadTrack(trackId, trackInfo, (progress) => {
        // Update progress setiap 10%
        if (progress.percent % 10 === 0) {
          ctx.telegram.editMessageText(
            chatId, progressMsg.message_id, null,
            `⬇️ *Downloading...*\n\n` +
            `🎵 **${trackInfo.title}**\n` +
            `👤 ${trackInfo.artist}\n\n` +
            `📥 ${progress.percent}% (${this.formatBytes(progress.downloaded)}/${this.formatBytes(progress.total)})`,
            { parse_mode: 'Markdown' }
          ).catch(() => {}); // Ignore error jika pesan sama
        }
      });
      
      // Cek ukuran file
      const stats = fs.statSync(filePath);
      console.log(`[MusicModule] Uploading file: ${filePath} (${stats.size} bytes)`);
      
      if (stats.size < 5000) {
        throw new Error(`File terlalu kecil: ${stats.size} bytes`);
      }
      
      // Upload ke Telegram dengan timeout lebih lama
      await ctx.telegram.editMessageText(
        chatId, progressMsg.message_id, null,
        `⬆️ *Uploading ke Telegram...*\n\n` +
        `🎵 **${trackInfo.title}**\n` +
        `👤 ${trackInfo.artist}\n` +
        `📦 ${this.formatBytes(stats.size)}`,
        { parse_mode: 'Markdown' }
      );
      
      // Upload dengan retry logic untuk handle network issues
      let uploadSuccess = false;
      let lastError = null;
      const maxRetries = 3;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          // Gunakan stream untuk upload yang lebih reliable
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
          console.error(`[MusicModule] Upload attempt ${attempt}/${maxRetries} failed:`, uploadError.message);
          
          if (attempt < maxRetries) {
            // Wait before retry (exponential backoff)
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
      
      if (!uploadSuccess) {
        throw lastError || new Error('Upload gagal setelah ' + maxRetries + ' percobaan');
      }
      
      // Hapus pesan progress
      await ctx.telegram.deleteMessage(chatId, progressMsg.message_id);
      
      // Hapus file temporary
      this.deleteTempFile(filePath);
      
    } catch (error) {
      console.error('[MusicModule] Download error:', error);
      
      // Pesan error yang lebih informatif
      let errorMsg = error.message;
      if (errorMsg.includes('autentikasi') || errorMsg.includes('authentication') || errorMsg.includes('cookies')) {
        errorMsg = `🔐 *Monochrome API Memerlukan Autentikasi*\n\n` +
          `Maaf, download dari Monochrome memerlukan login/cookies yang tidak tersedia di bot publik ini.\n\n` +
          `💡 *Solusi:*\n` +
          `• Gunakan website Monochrome langsung: https://monochrome.st\n` +
          `• Atau gunakan aplikasi desktop Monochrome\n` +
          `• Bot ini hanya bisa search (jika API public tersedia)`;
      } else if (errorMsg.includes('socket hang up') || errorMsg.includes('ECONNRESET') || errorMsg.includes('timeout')) {
        errorMsg = `🌐 *Network Error saat Upload ke Telegram*\n\n` +
          `File sudah didownload (${this.formatBytes(stats?.size || 0)}) tapi gagal upload ke Telegram.\n` +
          `Ini biasanya karena koneksi tidak stabil atau file terlalu besar.\n\n` +
          `💡 *Solusi:*\n` +
          `• Coba lagi nanti\n` +
          `• Atau gunakan website Monochrome langsung\n` +
          `• File tersedia di server bot (temp), hubungi admin jika perlu`;
      }
      
      await ctx.telegram.editMessageText(
        chatId, progressMsg.message_id, null,
        `❌ *Download gagal*\n\n` +
        `🎵 ${trackInfo.title} - ${trackInfo.artist}\n\n` +
        errorMsg,
        { parse_mode: 'Markdown' }
      );
    }
  }

  /**
   * Get track info dari API
   */
  async getTrackInfo(trackId) {
    try {
      const baseUrl = this.config.monochromeApiBaseUrl || this.config.apiBaseUrl;
      const trackEndpoint = this.config.monochromeTrackEndpoint || this.config.trackEndpoint;
      
      const url = `${baseUrl}${trackEndpoint}/${trackId}`;
      
      console.log(`[MusicModule] Getting track info: ${url}`);
      const response = await axios.get(url, {
        headers: { 'Accept': 'application/json' },
        timeout: 10000
      });
      
      if (response.data) {
        return this.formatSearchResults([response.data])[0];
      }
    } catch (error) {
      console.error('[MusicModule] Get track info error:', error.message);
    }
    return null;
  }

  /**
   * Download track dari Monochrome
   * Note: Actual download requires authentication/cookies dari Monochrome
   * Ini adalah implementasi struktur - perlu disesuaikan dengan API aktual
   */
  async downloadTrack(trackId, trackInfo, onProgress) {
    const fileName = this.sanitizeFileName(`${trackInfo.artist} - ${trackInfo.title}.flac`);
    const filePath = path.join(this.config.tempDir, fileName);
    
    // Gunakan config dari global
    const baseUrl = this.config.monochromeApiBaseUrl || this.config.apiBaseUrl;
    const downloadEndpoint = this.config.monochromeDownloadEndpoint || this.config.downloadEndpoint;
    
    const downloadUrls = [
      `${baseUrl}${downloadEndpoint}/${trackId}`,
      `${baseUrl}/download/${trackId}`,
      `${baseUrl}/api/download/${trackId}`
    ];
    
    for (const url of downloadUrls) {
      try {
        console.log(`[MusicModule] Trying download: ${url}`);
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
        
        // Save file
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
        
        // Cek ukuran file
        const stats = fs.statSync(filePath);
        if (stats.size > this.config.maxFileSize) {
          this.deleteTempFile(filePath);
          throw new Error(`File terlalu besar: ${this.formatBytes(stats.size)} (max: ${this.formatBytes(this.config.maxFileSize)})`);
        }
        
        if (stats.size < 1024) {
          this.deleteTempFile(filePath);
          throw new Error('File terlalu kecil, kemungkinan error');
        }
        
        console.log(`[MusicModule] Downloaded from ${url}: ${this.formatBytes(stats.size)}`);
        return filePath;
        
      } catch (error) {
        console.error(`[MusicModule] Download failed from ${url}:`, error.message);
        if (fs.existsSync(filePath)) this.deleteTempFile(filePath);
        continue;
      }
    }
    
    // Jika semua gagal, throw error - JANGAN pakai mock
    throw new Error(`Semua endpoint download gagal untuk track: ${trackId}. Monochrome API memerlukan autentikasi/cookies yang tidak tersedia di bot ini.`);
  }

  /**
   * Buat file demo (sine wave audio) untuk testing
   * Menggunakan spawn langsung karena fluent-ffmpeg bermasalah dengan lavfi di Windows
   * Sine wave lebih realistis & file size lebih besar dari silent audio
   */
  async createDemoFile(trackInfo, filePath) {
    const { spawn } = require('child_process');
    const ffmpegStatic = require('ffmpeg-static');
    
    if (!ffmpegStatic) {
      throw new Error('ffmpeg-static not found');
    }
    
    return new Promise((resolve, reject) => {
      // Escape metadata untuk command line
      const escapeMeta = (str) => str.replace(/"/g, '\\"');
      
      // Generate 30 detik sine wave 440Hz (A4) + 880Hz (A5) stereo
      // Lebih realistis & file size ~300-500KB untuk FLAC
      const args = [
        '-f', 'lavfi',
        '-i', 'sine=frequency=440:duration=30:sample_rate=44100',
        '-f', 'lavfi',
        '-i', 'sine=frequency=880:duration=30:sample_rate=44100',
        '-filter_complex', '[0:a][1:a]amerge=inputs=2[aout]',
        '-map', '[aout]',
        '-c:a', 'flac',
        '-compression_level', '5',
        '-metadata', `title="${escapeMeta(trackInfo.title)}"`,
        '-metadata', `artist="${escapeMeta(trackInfo.artist)}"`,
        '-metadata', `album="${escapeMeta(trackInfo.album)}"`,
        filePath
      ];
      
      console.log('[MusicModule] Running ffmpeg demo generation (30s sine wave)...');
      const proc = spawn(ffmpegStatic, args);
      
      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(filePath)) {
          const stats = fs.statSync(filePath);
          if (stats.size > 10000) { // Min 10KB
            console.log(`[MusicModule] Demo file created: ${filePath} (${stats.size} bytes)`);
            resolve(filePath);
          } else {
            reject(new Error(`Generated file too small: ${stats.size} bytes`));
          }
        } else {
          console.error('[MusicModule] FFmpeg failed:', stderr);
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
        }
      });
      
      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
      });
    });
  }

  /**
   * Cleanup file temporary
   */
  deleteTempFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`[MusicModule] Deleted temp file: ${filePath}`);
      }
    } catch (error) {
      console.error('[MusicModule] Error deleting temp file:', error);
    }
  }

  /**
   * Cleanup file lama (> 1 jam)
   */
  cleanupTempFiles() {
    try {
      const files = fs.readdirSync(this.config.tempDir);
      const now = Date.now();
      const maxAge = 60 * 60 * 1000; // 1 jam
      
      files.forEach(file => {
        const filePath = path.join(this.config.tempDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAge) {
          this.deleteTempFile(filePath);
        }
      });
    } catch (error) {
      console.error('[MusicModule] Cleanup error:', error);
    }
  }

  /**
   * Helper: Format duration (detik -> MM:SS)
   */
  formatDuration(seconds) {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Helper: Format bytes
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Helper: Sanitize filename
   */
  sanitizeFileName(name) {
    return name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200);
  }
}

module.exports = MusicModule;