import { ContactsService } from '../../services/contacts.js';
import chalk from 'chalk';

export async function listContacts(): Promise<void> {
  const contactsService = new ContactsService();

  try {
    const contacts = await contactsService.loadContacts();
    
    if (contacts.length === 0) {
      console.log(chalk.gray('No saved contacts found'));
      console.log(chalk.gray('Use "outlook-agent contacts sync" to sync from Outlook'));
      return;
    }

    console.log(chalk.bold('\nSaved Contacts:'));
    console.log(chalk.gray('─'.repeat(80)));
    
    contacts.forEach(contact => {
      const aliasText = contact.alias ? chalk.cyan(` @${contact.alias}`) : '';
      const tagsText = contact.tags?.length ? chalk.gray(` [${contact.tags.join(', ')}]`) : '';
      console.log(`${contact.name}${aliasText} <${contact.email}>${tagsText}`);
    });
    
    console.log(chalk.gray('─'.repeat(80)));
    console.log(chalk.gray(`Total: ${contacts.length} contacts`));
  } catch (error) {
    console.error(chalk.red('Failed to list contacts:'), error);
    process.exit(1);
  }
}