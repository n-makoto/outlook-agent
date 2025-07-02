import { ContactsService } from '../../services/contacts.js';
import chalk from 'chalk';
import inquirer from 'inquirer';

export async function addContact(email?: string): Promise<void> {
  const contactsService = new ContactsService();

  try {
    let contactEmail = email;
    let contactName = '';
    let alias = '';

    if (!contactEmail) {
      // インタラクティブモード
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'email',
          message: 'Email address:',
          validate: (input: string) => {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return emailRegex.test(input) || 'Please enter a valid email address';
          }
        },
        {
          type: 'input',
          name: 'name',
          message: 'Name:',
          validate: (input: string) => input.length > 0 || 'Name is required'
        },
        {
          type: 'input',
          name: 'alias',
          message: 'Alias (optional):'
        }
      ]);

      contactEmail = answers.email;
      contactName = answers.name;
      alias = answers.alias;
    } else {
      // 名前を入力
      const { name } = await inquirer.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'Name:',
          validate: (input: string) => input.length > 0 || 'Name is required'
        }
      ]);
      contactName = name;
    }

    // 既存の連絡先を読み込み
    const contacts = await contactsService.loadContacts();
    
    // 新しい連絡先を追加
    const newContact = {
      email: contactEmail!,
      name: contactName,
      alias: alias || undefined
    };

    // 重複チェック
    const existingIndex = contacts.findIndex(c => 
      c.email.toLowerCase() === contactEmail!.toLowerCase()
    );

    if (existingIndex >= 0) {
      // 既存の連絡先を更新
      contacts[existingIndex] = { ...contacts[existingIndex], ...newContact };
      console.log(chalk.yellow(`✓ Updated contact: ${contactName}`));
    } else {
      // 新規追加
      contacts.push(newContact);
      console.log(chalk.green(`✓ Added contact: ${contactName}`));
    }

    // 保存
    await contactsService.saveContacts(contacts);

    // キャッシュをクリア
    const { promises: fs } = await import('fs');
    const { homedir } = await import('os');
    const path = await import('path');
    const cacheFile = path.join(homedir(), '.outlook-agent', 'contacts-cache.json');
    try {
      await fs.unlink(cacheFile);
    } catch {
      // ファイルが存在しない場合は無視
    }
  } catch (error) {
    console.error(chalk.red('Failed to add contact:'), error);
    process.exit(1);
  }
}