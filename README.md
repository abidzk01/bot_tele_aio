# Telegram Music Downloader Bot

A modular Telegram bot built with Node.js and Telegraf for searching and downloading music from Monochrome (https://monochrome.st).

## Features

- 🔍 **Search Music** - Search tracks via Monochrome API
- ⬇️ **Download Music** - Download FLAC audio streams directly from Monochrome
- 🎵 **Inline Keyboards** - Interactive buttons for track selection and pagination
- 📥 **Progress Tracking** - Real-time download/upload progress updates
- 🔁 **Retry Logic** - Automatic retry with exponential backoff for network issues
- 🧹 **Auto Cleanup** - Temporary files deleted after upload, cron job for old files
- 🔐 **Admin System** - Role-based command access control
- 📦 **Modular Architecture** - Easy to extend with new modules

## Commands

| Command | Description |
|---------|-------------|
| `/music <query>` | Search and download music (main command) |
| `/search <query>` | Search music only |
| `/download <track_id>` | Download by track ID |
| `/start` | Start bot with welcome message |
| `/help` | Show help message |
| `/about` | Bot information |
| `/time` | Current server time (WIB) |
| `/system` | System info (admin only) |

## Architecture

```
music_downloader_bot/
├── index.js              # Entry point, global config
├── package.json
├── .env                  # Environment variables
├── .env.example          # Environment template
└── modules/
    ├── BaseModule.js     # Base class with admin middleware
    ├── ModuleLoader.js   # Auto-load modules from folder
    ├── TemplateModule.js # Template for new modules
    ├── MusicModule.js    # Main: Search & Download from Monochrome
    ├── StartModule.js    # /start command
    ├── HelpModule.js     # /help command (auto-generates from commands)
    ├── AboutModule.js    # /about command
    ├── TimeModule.js     # /time command
    ├── EchoModule.js     # /echo command
    └── SystemModule.js   # /system command (admin only)
```

## Installation

1. **Clone and install dependencies**
```bash
git clone <repository>
cd music_downloader_bot
npm install
```

2. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your values
```

3. **Get Telegram Bot Token**
- Message [@BotFather](https://t.me/BotFather) on Telegram
- Create new bot: `/newbot`
- Copy the token to `.env`

4. **Get Admin User IDs** (optional)
- Message [@userinfobot](https://t.me/userinfobot) on Telegram
- Add IDs to `ADMIN_IDS` in `.env` (comma-separated)

5. **Run the bot**
```bash
npm start
# Development with auto-reload
npm run dev
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BOT_TOKEN` | Telegram bot token from BotFather | Yes |
| `BOT_NAME` | Bot display name | No (default: "Simple Telegram Bot") |
| `BOT_VERSION` | Bot version | No (default: "1.0.0") |
| `AUTHOR_NAME` | Author name for /about | No |
| `AUTHOR_EMAIL` | Author email for /about | No |
| `ADMIN_IDS` | Comma-separated Telegram user IDs | No |

## Monochrome API Integration

The bot uses Monochrome's public endpoints:

- **Search**: `GET https://tracks.monochrome.st/search?q={query}`
  - Returns: `{ tracks, releases, artists, users, playlists }`
- **Download**: `GET https://tracks.monochrome.st/track/{trackId}`
  - Returns: FLAC audio stream (~30-50MB per track)

> **Note**: Search API is public, download streams are direct links. No authentication required for current endpoints.

## Module Development

### Creating a New Module

1. Copy template:
```bash
cp modules/TemplateModule.js modules/MyModule.js
```

2. Edit `MyModule.js`:
```javascript
class MyModule extends BaseModule {
  constructor() {
    super();
    this.name = 'mymodule';        // Unique, lowercase
    this.description = 'My module';
    this.commands = [
      { command: 'mycmd', description: 'My command', adminOnly: false }
    ];
  }

  async init(bot, config) {
    await super.init(bot, config);
    // config available: this.config.botToken, this.config.adminIds, etc.
  }

  registerHandlers() {
    this.bot.command('mycmd', async (ctx) => {
      await ctx.reply('Hello from my module!');
    });
    
    // Admin-only command
    this.bot.command('admincmd', this.adminOnlyMiddleware(), async (ctx) => {
      await ctx.reply('Admin only!');
    });
  }
}

module.exports = MyModule;
```

3. Restart bot - auto-loaded!

### BaseModule Helpers

- `this.isAdmin(userId)` - Check if user is admin
- `this.adminOnlyMiddleware()` - Protect command for admins only
- `this.reply(ctx, text, options)` - Reply with Markdown
- `this.replyError(ctx, error)` - Standard error reply
- `this.config` - Access to all env config

## Error Handling

- **Network errors**: Automatic retry (3 attempts, exponential backoff)
- **File validation**: Min 5KB, Max 50MB
- **Auto cleanup**: Files deleted after upload, cron cleans >1hr old files
- **User-friendly errors**: Descriptive messages for auth, network, timeout issues

## License

MIT