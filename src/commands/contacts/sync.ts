import { ContactsService } from '../../services/contacts.js';
import chalk from 'chalk';
import inquirer from 'inquirer';

export async function syncContacts(options: { group?: string; list?: boolean } = {}): Promise<void> {
  const contactsService = new ContactsService();

  try {
    // --listオプションの場合、グループ一覧を表示
    if (options.list) {
      console.log(chalk.blue('Fetching contact groups...'));
      const groups = await contactsService.listContactGroups();
      
      if (groups.length === 0) {
        console.log(chalk.yellow('No contact groups found'));
        return;
      }

      console.log(chalk.bold('\nAvailable Contact Groups:'));
      console.log(chalk.gray('─'.repeat(50)));
      groups.forEach(group => {
        console.log(`- ${group.displayName}`);
      });
      console.log(chalk.gray('─'.repeat(50)));
      return;
    }

    // グループ名の取得
    let groupName = options.group;
    if (!groupName) {
      // インタラクティブにグループを選択
      const groups = await contactsService.listContactGroups();
      if (groups.length === 0) {
        console.log(chalk.yellow('No contact groups found'));
        return;
      }

      const { selectedGroup } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedGroup',
          message: 'Select a contact group to sync:',
          choices: groups.map(g => ({
            name: g.displayName,
            value: g.displayName
          }))
        }
      ]);
      groupName = selectedGroup;
    }

    // 同期実行
    console.log(chalk.blue(`Syncing contacts from group "${groupName}"...`));
    await contactsService.syncWithOutlookGroup(groupName!);
    
    // 同期結果を表示
    const contacts = await contactsService.loadContacts();
    const groupContacts = contacts.filter(c => c.tags?.includes(groupName!));
    
    console.log(chalk.green(`✓ Successfully synced ${groupContacts.length} contacts from "${groupName}"`));
  } catch (error) {
    console.error(chalk.red('Failed to sync contacts:'), error);
    process.exit(1);
  }
}