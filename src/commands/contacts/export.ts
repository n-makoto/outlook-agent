import { ContactsService } from '../../services/contacts.js';
import chalk from 'chalk';
import { promises as fs } from 'fs';

export async function exportContacts(options: { output?: string; format?: string } = {}): Promise<void> {
  const contactsService = new ContactsService();

  try {
    console.log(chalk.blue('Exporting contacts...'));
    
    // Load all contacts
    const contacts = await contactsService.loadContacts();
    
    if (contacts.length === 0) {
      console.log(chalk.yellow('No contacts found to export'));
      return;
    }

    // Determine output format
    const format = options.format?.toLowerCase() || 'json';
    let content: string;
    let filename: string;

    if (format === 'json') {
      content = JSON.stringify(contacts, null, 2);
      filename = options.output || 'contacts.json';
    } else if (format === 'csv') {
      // CSV format
      const headers = ['email', 'name', 'alias', 'tags', 'frequency'];
      const rows = [headers.join(',')];
      
      contacts.forEach(contact => {
        const row = [
          contact.email,
          contact.name || '',
          contact.alias || '',
          (contact.tags || []).join(';'),
          contact.frequency?.toString() || '0'
        ];
        rows.push(row.map(field => `"${field.replace(/"/g, '""')}"`).join(','));
      });
      
      content = rows.join('\n');
      filename = options.output || 'contacts.csv';
    } else {
      console.error(chalk.red(`Unsupported format: ${format}. Use 'json' or 'csv'`));
      return;
    }

    // Write to file
    await fs.writeFile(filename, content, 'utf-8');
    
    console.log(chalk.green(`✓ Exported ${contacts.length} contacts to ${filename}`));
  } catch (error: any) {
    console.error(chalk.red('Failed to export contacts:'), error.message || error);
    process.exit(1);
  }
}