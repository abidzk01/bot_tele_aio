import { resolve } from 'path';
import { existsSync, unlinkSync } from 'fs';

const DB_PATH = process.env.DB_PATH || resolve('./data/bot.sqlite');

if (existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log('🗑️  Deleted existing database:', DB_PATH);
} else {
  console.log('ℹ️  No database found at:', DB_PATH);
}

console.log('🔄 Re-initializing database...');
import('./init-db.js');