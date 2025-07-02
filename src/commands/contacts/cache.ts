import { ContactsService } from '../../services/contacts.js';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';
import chalk from 'chalk';

export async function cacheCommand(options: { clear?: boolean } = {}): Promise<void> {
  if (options.clear) {
    try {
      const cacheFile = path.join(homedir(), '.outlook-agent', 'contacts-cache.json');
      await fs.unlink(cacheFile);
      console.log(chalk.green('✓ Contacts cache cleared successfully'));
    } catch (error) {
      console.log(chalk.yellow('No cache to clear'));
    }
  } else {
    const contactsService = new ContactsService();
    console.log(chalk.blue('Rebuilding contacts cache...'));
    
    try {
      // キャッシュを強制的に再構築
      const cacheFile = path.join(homedir(), '.outlook-agent', 'contacts-cache.json');
      try {
        await fs.unlink(cacheFile);
      } catch {
        // ファイルが存在しない場合は無視
      }
      
      // 新しいキャッシュを構築
      await contactsService.getRecentContacts();
      console.log(chalk.green('✓ Contacts cache rebuilt successfully'));
    } catch (error) {
      console.error(chalk.red('Failed to rebuild cache:'), error);
    }
  }
}