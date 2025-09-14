import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { viewCalendar } from './commands/calendar/view.js';
import { createEvent } from './commands/calendar/create.js';
import { checkFreeBusy } from './commands/calendar/freebusy.js';
import { rescheduleEvent } from './commands/calendar/reschedule.js';
import { manageConflicts } from './commands/calendar/conflicts.js';
import { syncContacts } from './commands/contacts/sync.js';
import { listContacts } from './commands/contacts/list.js';
import { addContact } from './commands/contacts/add.js';
import { cacheCommand } from './commands/contacts/cache.js';
import { exportContacts } from './commands/contacts/export.js';
import { importContacts } from './commands/contacts/import.js';
import { bulkAddContacts } from './commands/contacts/bulk-add.js';
import { doctor } from './commands/doctor.js';
import { login } from './commands/auth/login.js';
import { logout } from './commands/auth/logout.js';
import { scheduleWeek } from './commands/agent/schedule-week.js';

// Get package.json version dynamically
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const version = packageJson.version;

export function createCLI(): Command {
  const program = new Command();
  
  program
    .name('outlook-agent')
    .description('CLI tool for managing Outlook calendar')
    .version(version);

  // カレンダーコマンドグループ
  const calendar = program
    .command('calendar')
    .description('Calendar operations');

  // カレンダー表示コマンド
  calendar
    .command('view')
    .description('View calendar events')
    .option('-d, --date <date>', 'Specific date (YYYY-MM-DD)')
    .option('-u, --user [email]', 'View another user\'s calendar (interactive if no email provided)')
    .option('--json', 'Output in JSON format for LLM integration')
    .action(viewCalendar);

  // イベント作成コマンド
  calendar
    .command('create')
    .description('Create a new calendar event')
    .option('-i, --interactive', 'Interactive mode')
    .option('-f, --find-slot', 'Find available time slot with attendees')
    .option('-n, --non-interactive', 'Non-interactive mode for automation')
    .option('-s, --subject <subject>', 'Event subject (required for non-interactive)')
    .option('-a, --attendees <emails...>', 'Attendee emails (comma-separated, required for non-interactive)')
    .option('-d, --duration <minutes>', 'Meeting duration in minutes (default: 30)', '30')
    .option('-o, --output-format <format>', 'Output format: json or text (default: text)', 'text')
    .action((options) => {
      // attendeesをカンマ区切りで分割
      if (options.attendees && typeof options.attendees === 'string') {
        options.attendees = options.attendees.split(',').map((email: string) => email.trim());
      }
      options.duration = parseInt(options.duration);
      return createEvent(options);
    });

  // Free/Busy確認コマンド
  calendar
    .command('freebusy [email]')
    .description('Check free/busy status of a user')
    .option('-d, --days <number>', 'Number of days to check (default: 7)', '7')
    .action((email, options) => checkFreeBusy({ user: email, days: parseInt(options.days) }));

  // リスケジュールコマンド
  calendar
    .command('reschedule [eventId]')
    .description('Reschedule an existing event by finding new available time slots')
    .action(rescheduleEvent);

  // コンフリクト管理コマンド
  calendar
    .command('conflicts')
    .description('Detect and manage scheduling conflicts')
    .option('-d, --days <number>', 'Number of days to check (default: 7)', '7')
    .action((options) => manageConflicts(parseInt(options.days)));

  // 連絡先コマンドグループ
  const contacts = program
    .command('contacts')
    .description('Contact management operations');

  // 連絡先同期コマンド
  contacts
    .command('sync')
    .description('Sync contacts from Outlook groups')
    .option('-g, --group <name>', 'Specific group name to sync')
    .option('-l, --list', 'List available contact groups')
    .action(syncContacts);

  // 連絡先一覧コマンド
  contacts
    .command('list')
    .description('List saved contacts')
    .action(listContacts);

  // 連絡先追加コマンド
  contacts
    .command('add [email]')
    .description('Add a contact')
    .action(addContact);

  // バルク追加コマンド
  contacts
    .command('bulk-add')
    .description('Add multiple contacts interactively')
    .action(bulkAddContacts);

  // キャッシュ管理コマンド
  contacts
    .command('cache')
    .description('Manage contacts cache')
    .option('-c, --clear', 'Clear the cache')
    .action(cacheCommand);

  // エクスポートコマンド
  contacts
    .command('export')
    .description('Export contacts to file')
    .option('-o, --output <file>', 'Output filename')
    .option('-f, --format <format>', 'Output format (json or csv)', 'json')
    .action(exportContacts);

  // インポートコマンド
  contacts
    .command('import [file]')
    .description('Import contacts from file')
    .option('-m, --merge', 'Merge with existing contacts instead of replacing')
    .option('-f, --format <format>', 'Input format (json or csv, auto-detected by default)')
    .action(importContacts);

  // Doctorコマンド
  program
    .command('doctor')
    .description('Check your environment setup')
    .action(doctor);

  // 認証コマンド
  program
    .command('login')
    .description('Login to Microsoft Graph (automatically opens browser)')
    .option('--scopes <scopes>', 'Custom scopes (default: all required permissions)')
    .action(login);

  // ログアウトコマンド
  program
    .command('logout')
    .description('Logout from Microsoft Graph')
    .action(logout);

  // エージェントコマンドグループ
  const agent = program
    .command('agent')
    .description('AI agent operations for automated scheduling');

  // 週次スケジュール調整コマンド
  agent
    .command('schedule-week')
    .description('Analyze and optimize weekly schedule conflicts')
    .option('-d, --dry-run', 'Preview changes without applying them')
    .option('--date <date>', 'Start date for the week (YYYY-MM-DD)')
    .option('--json', 'Output in JSON format')
    .option('--rules <file>', 'Path to custom scheduling rules YAML file')
    .option('--instructions <file>', 'Path to custom AI instructions YAML file')
    .action(scheduleWeek);

  return program;
}