# Bot Telegram AIO

**All-in-One Telegram Bot** - Modular bot with music downloader, system monitoring, and extensible module system.

## Features

- 🎵 **Music Downloader** - Search & download FLAC from Monochrome (https://monochrome.st)
- 📊 **System Monitor** - CPU, RAM, disk, uptime via `/system` (admin only)
- 🔧 **Modular Architecture** - Easy to extend with new modules
- 🎮 **Interactive UI** - Inline keyboards, pagination, progress tracking
- 🔁 **Smart Retry** - Exponential backoff for network reliability
- 🔐 **Admin System** - Role-based command access control
- 🧹 **Auto Cleanup** - Temp files deleted after upload, cron job for old files

## Commands

| Command | Description | Access |
|---------|-------------|--------|
| `/music <query>` | Search & download music | All |
| `/search <query>` | Search music only | All |
| `/download <track_id>` | Download by track ID | All |
| `/start` | Welcome message & menu | All |
| `/help` | Auto-generated command list | All |
| `/about` | Bot info (version, author) | All |
| `/time` | Server time (WIB) | All |
| `/system` | System info (CPU, RAM, disk) | Admin |
| `/echo <text>` | Echo text back | All |

## Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/abidzk01/bot_tele_aio.git
cd bot_tele_aio
npm install
```

### 2. Configure
```bash
cp .env.example .env
# Edit .env with your values
```

Required:
- `BOT_TOKEN` - From [@BotFather](https://t.me/BotFather)

Optional:
- `ADMIN_IDS` - Comma-separated Telegram user IDs (from [@userinfobot](https://t.me/userinfobot))
- `BOT_NAME`, `BOT_VERSION`, `AUTHOR_NAME`, `AUTHOR_EMAIL`

### 3. Run
```bash
npm start
# Development with auto-reload
npm run dev
```

## Architecture

```
bot_tele_aio/
├── index.js              # Entry point, global config
├── package.json
├── .env                  # Environment variables (not in git)
├── .env.example          # Template
└── modules/
    ├── BaseModule.js     # Base class with admin middleware
    ├── ModuleLoader.js   # Auto-load modules from folder
    ├── TemplateModule.js # Template for new modules
    ├── MusicModule.js    # Search & Download from Monochrome
    ├── StartModule.js    # /start command
    ├── HelpModule.js     # /help (auto-generates from commands)
    ├── AboutModule.js    # /about with config info
    ├── TimeModule.js     # /time (WIB)
    ├── EchoModule.js     # /echo
    └── SystemModule.js   # /system (admin only)
```

## Module Development

### Create New Module
```bash
cp modules/TemplateModule.js modules/MyModule.js
```

```javascript
class MyModule extends BaseModule {
  constructor() {
    super();
    this.name = 'mymodule';
    this.description = 'My custom module';
    this.commands = [
      { command: 'mycmd', description: 'My command', adminOnly: false }
    ];
  }

  async init(bot, config) {
    await super.init(bot, config);
    // Access: this.config.botToken, this.config.adminIds, etc.
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

Restart bot - auto-loaded!

### BaseModule Helpers
- `this.isAdmin(userId)` - Check admin status
- `this.adminOnlyMiddleware()` - Protect command for admins
- `this.reply(ctx, text, options)` - Reply with Markdown
- `this.replyError(ctx, error)` - Standard error reply
- `this.config` - All env config

## Monochrome API Integration

- **Search**: `GET https://tracks.monochrome.st/search?q={query}`
  - Returns: `{ tracks, releases, artists, users, playlists }`
- **Download**: `GET https://tracks.monochrome.st/track/{trackId}`
  - Returns: FLAC audio stream (~30-50MB per track)

No authentication required for current public endpoints.

## Error Handling

- **Network errors**: Auto-retry (3 attempts, exponential backoff 2s/4s/6s)
- **File validation**: Min 5KB, Max 50MB
- **Auto cleanup**: Files deleted after upload, cron cleans >1hr old files
- **User-friendly errors**: Descriptive messages for auth, network, timeout

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BOT_TOKEN` | Telegram bot token from BotFather | Yes |
| `BOT_NAME` | Bot display name | No (default: "Bot Telegram AIO") |
| `BOT_VERSION` | Bot version | No (default: "1.0.0") |
| `AUTHOR_NAME` | Author for /about | No |
| `AUTHOR_EMAIL` | Author email for /about | No |
| `ADMIN_IDS` | Comma-separated Telegram user IDs | No |

## License

MIT