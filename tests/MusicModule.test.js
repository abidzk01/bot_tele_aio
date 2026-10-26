import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import { setupTestEnvironment, teardownTestEnvironment, createMockContext, createMockBot } from './setup.js';
import MusicModule from '../modules/MusicModule.js';
import { createLogger } from '../modules/Logger.js';
import { createRateLimiter } from '../modules/RateLimiter.js';
import { Database } from '../modules/Database.js';

let env;
let mockBot;
let mockContext;
let musicModule;
let config;

beforeAll(async () => {
  env = await setupTestEnvironment();
  mockBot = createMockBot();
}, 15000);

afterAll(async () => {
  teardownTestEnvironment();
}, 10000);

beforeEach(() => {
  config = {
    botToken: 'test',
    botName: 'Test Bot',
    botVersion: '1.0.0',
    authorName: 'Test',
    authorEmail: 'test@test.com',
    adminIds: ['123456789'],
    monochromeApiBaseUrl: 'https://tracks.monochrome.st',
    monochromeSearchEndpoint: '/search',
    monochromeTrackEndpoint: '/api/v1/track',
    monochromeDownloadEndpoint: '/track',
    logger: createLogger('TestMusicModule'),
    db: Database,
    rateLimiter: createRateLimiter(),
  };
  
  mockContext = createMockContext({ userId: 'musicuser' });
  // Make reply a jest mock
  mockContext.reply = jest.fn().mockResolvedValue({ message_id: 1, text: 'mock reply' });
  mockContext.telegram.editMessageText = jest.fn().mockResolvedValue({ message_id: 1, text: 'edited' });
  mockContext.telegram.deleteMessage = jest.fn().mockResolvedValue(true);
  mockContext.answerCbQuery = jest.fn().mockResolvedValue(true);
  mockContext.telegram.setMyCommands = jest.fn().mockResolvedValue(true);
  
  musicModule = new MusicModule();
});

afterEach(async () => {
  // Cleanup
  musicModule.searchCache.clear();
  musicModule.downloadCache.clear();
});

describe('MusicModule', () => {
  test('should initialize with config', async () => {
    await musicModule.init(mockBot, config);
    
    expect(musicModule.bot).toBe(mockBot);
    expect(musicModule.config).toBeDefined();
    expect(musicModule.logger).toBeDefined();
    expect(musicModule.rateLimiter).toBeDefined();
    expect(musicModule.db).toBe(Database);
    expect(musicModule.config.tempDir).toBeDefined();
  });

  test('should register commands', async () => {
    await musicModule.init(mockBot, config);
    
    expect(mockBot.commands.has('music')).toBe(true);
    expect(mockBot.commands.has('search')).toBe(true);
    expect(mockBot.commands.has('download')).toBe(true);
  });

  test('should have correct command definitions', async () => {
    await musicModule.init(mockBot, config);
    
    const commands = musicModule.getCommandDefinitions();
    expect(commands.length).toBe(3);
    expect(commands.map(c => c.command)).toEqual(['music', 'search', 'download']);
  });

  test('should format duration correctly', async () => {
    await musicModule.init(mockBot, config);
    
    expect(musicModule.formatDuration(0)).toBe('--:--');
    expect(musicModule.formatDuration(30)).toBe('0:30');
    expect(musicModule.formatDuration(90)).toBe('1:30');
    expect(musicModule.formatDuration(3661)).toBe('61:01');
  });

  test('should format bytes correctly', async () => {
    await musicModule.init(mockBot, config);
    
    expect(musicModule.formatBytes(0)).toBe('0 B');
    expect(musicModule.formatBytes(1024)).toBe('1 KB');
    expect(musicModule.formatBytes(1048576)).toBe('1 MB');
    expect(musicModule.formatBytes(1073741824)).toBe('1 GB');
  });

  test('should sanitize filename', async () => {
    await musicModule.init(mockBot, config);
    
    expect(musicModule.sanitizeFileName('normal_file.mp3')).toBe('normal_file.mp3');
    expect(musicModule.sanitizeFileName('file<with>bad:chars.mp3')).toBe('file_with_bad_chars.mp3');
    expect(musicModule.sanitizeFileName('  spaces  ')).toBe('spaces');
    expect(musicModule.sanitizeFileName('a'.repeat(250))).toHaveLength(200);
  });

  test('should handle search cache', async () => {
    await musicModule.init(mockBot, config);
    
    const userId = 'cacheuser';
    const query = 'test query';
    const results = [{ id: '1', title: 'Test', artist: 'Artist', album: 'Album', duration: 180 }];
    
    musicModule.searchCache.set(userId, { query, results, page: 0, timestamp: Date.now() });
    
    const cache = musicModule.searchCache.get(userId);
    expect(cache).toBeDefined();
    expect(cache.query).toBe(query);
    expect(cache.results).toEqual(results);
  });

  test('should acquire and release download semaphore', async () => {
    await musicModule.init(mockBot, config);
    
    expect(musicModule.downloadSemaphore).toBe(0);
    
    const promise1 = musicModule.acquireDownloadSemaphore(null);
    await promise1;
    expect(musicModule.downloadSemaphore).toBe(1);
    
    const promise2 = musicModule.acquireDownloadSemaphore(null);
    await promise2;
    expect(musicModule.downloadSemaphore).toBe(2);
    
    // Third should queue
    const promise3 = musicModule.acquireDownloadSemaphore(null);
    expect(musicModule.downloadQueue.length).toBe(1);
    
    musicModule.releaseDownloadSemaphore();
    await promise3;
    expect(musicModule.downloadSemaphore).toBe(2);
    expect(musicModule.downloadQueue.length).toBe(0);
  });

  test('should acquire and release upload semaphore', async () => {
    await musicModule.init(mockBot, config);
    
    expect(musicModule.uploadSemaphore).toBe(0);
    
    const promise1 = musicModule.acquireUploadSemaphore(null);
    await promise1;
    expect(musicModule.uploadSemaphore).toBe(1);
    
    // Second should queue
    const promise2 = musicModule.acquireUploadSemaphore(null);
    expect(musicModule.uploadQueue.length).toBe(1);
    
    musicModule.releaseUploadSemaphore();
    await promise2;
    expect(musicModule.uploadSemaphore).toBe(1);
    expect(musicModule.uploadQueue.length).toBe(0);
  });

  test('should format search results', async () => {
    await musicModule.init(mockBot, config);
    
    const items = [
      { id: '1', title: 'Song 1', artist: { name: 'Artist 1' }, album: { title: 'Album 1' }, duration: 180 },
      { id: '2', title: 'Song 2', artists: [{ name: 'Artist 2' }], album: 'Album 2', duration: 200 },
    ];
    
    const results = musicModule.formatSearchResults(items);
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('1');
    expect(results[0].artist).toBe('Artist 1');
    expect(results[0].album).toBe('Album 1');
    expect(results[1].artist).toBe('Artist 2');
    expect(results[1].album).toBe('Album 2');
  });

  test('should filter mock search results', async () => {
    await musicModule.init(mockBot, config);
    
    const results = musicModule.getMockSearchResults('peterpan');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => 
      r.title.toLowerCase().includes('peterpan') || 
      r.artist.toLowerCase().includes('peterpan')
    )).toBe(true);
    
    const noResults = musicModule.getMockSearchResults('nonexistentband123');
    expect(noResults.length).toBe(0);
  });

  describe('handleSearch', () => {
    test('should reply with usage when no query', async () => {
      await musicModule.init(mockBot, config);
      
      const ctx = createMockContext({ 
        userId: 'searchuser',
        text: '/music'
      });
      ctx.reply = jest.fn().mockResolvedValue({ message_id: 1, text: 'mock reply' });
      
      await musicModule.handleSearch(ctx, '');
      
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Music Downloader'),
        expect.objectContaining({ parse_mode: 'Markdown' })
      );
    });
  });

  describe('showSearchResults', () => {
    test('should show no results message', async () => {
      await musicModule.init(mockBot, config);
      
      const ctx = createMockContext({ userId: 'showuser' });
      ctx.reply = jest.fn().mockResolvedValue({ message_id: 1, text: 'mock reply' });
      ctx.telegram.editMessageText = jest.fn().mockResolvedValue({ message_id: 1, text: 'edited' });
      
      await musicModule.showSearchResults(ctx, 'no results', 0, false, null);
      
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Tidak ditemukan hasil'),
        expect.any(Object)
      );
    });
  });
});