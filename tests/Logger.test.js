import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { setupTestEnvironment, teardownTestEnvironment } from './setup.js';
import { createLogger, getLogger, setLogLevel, LogLevels } from '../modules/Logger.js';

let env;

beforeAll(async () => {
  env = await setupTestEnvironment();
}, 10000);

afterAll(async () => {
  teardownTestEnvironment();
}, 10000);

describe('Logger', () => {
  describe('createLogger', () => {
    test('should create logger with module name', () => {
      const logger = createLogger('TestModule');
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    test('should create child logger with bindings', () => {
      const logger = createLogger('TestModule', { userId: '123', requestId: 'abc' });
      expect(logger).toBeDefined();
    });

    test('should return same logger instance for same module and bindings', () => {
      const logger1 = createLogger('TestModule', { userId: '123' });
      const logger2 = createLogger('TestModule', { userId: '123' });
      
      expect(logger1).toBe(logger2);
    });

    test('should create different loggers for different bindings', () => {
      const logger1 = createLogger('TestModule', { userId: '123' });
      const logger2 = createLogger('TestModule', { userId: '456' });
      
      expect(logger1).not.toBe(logger2);
    });
  });

  describe('log levels', () => {
    test('should have all log levels', () => {
      expect(LogLevels.TRACE).toBe('trace');
      expect(LogLevels.DEBUG).toBe('debug');
      expect(LogLevels.INFO).toBe('info');
      expect(LogLevels.WARN).toBe('warn');
      expect(LogLevels.ERROR).toBe('error');
      expect(LogLevels.FATAL).toBe('fatal');
    });

    test('should log at different levels', () => {
      const logger = createLogger('LevelTest');
      
      expect(() => {
        logger.trace('trace message');
        logger.debug('debug message');
        logger.info('info message');
        logger.warn('warn message');
        logger.error('error message');
        logger.fatal('fatal message');
      }).not.toThrow();
    });

    test('should log with metadata', () => {
      const logger = createLogger('MetadataTest');
      
      expect(() => {
        logger.info({ userId: '123', action: 'login' }, 'User logged in');
        logger.error({ err: new Error('test error'), code: 'ERR_TEST' }, 'Operation failed');
      }).not.toThrow();
    });
  });

  describe('setLogLevel', () => {
    test('should change log level', () => {
      const logger = getLogger();
      const originalLevel = logger.level;
      
      setLogLevel('debug');
      expect(logger.level).toBe('debug');
      
      setLogLevel(originalLevel);
    });
  });

  describe('getLogger', () => {
    test('should return root logger', () => {
      const logger = getLogger();
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
    });
  });
});