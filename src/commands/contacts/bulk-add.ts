import { ContactsService } from '../../services/contacts.js';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { Contact } from '../../types/contact.js';

export async function bulkAddContacts(): Promise<void> {
  const contactsService = new ContactsService();

  try {
    console.log(chalk.blue('Bulk add contacts'));
    console.log(chalk.gray('Enter contacts in format: email,name (one per line)'));
    console.log(chalk.gray('Leave blank and press Enter when done\n'));

    const newContacts: Contact[] = [];
    let done = false;

    while (!done) {
      const { input } = await inquirer.prompt([
        {
          type: 'input',
          name: 'input',
          message: `Contact ${newContacts.length + 1}:`,
          validate: (value: string) => {
            if (!value) return true; // Empty is OK (means done)
            const parts = value.split(',').map(p => p.trim());
            if (parts.length < 1 || !parts[0]) {
              return 'Email is required';
            }
            // Basic email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(parts[0])) {
              return 'Invalid email format';
            }
            return true;
          }
        }
      ]);

      if (!input) {
        done = true;
      } else {
        const parts = input.split(',').map((p: string) => p.trim());
        const email = parts[0];
        const name = parts[1] || email;

        newContacts.push({ email, name });
      }
    }

    if (newContacts.length === 0) {
      console.log(chalk.yellow('No contacts added'));
      return;
    }

    // Confirm addition
    console.log(chalk.blue(`\nContacts to add:`));
    newContacts.forEach(contact => {
      console.log(`  - ${contact.name} <${contact.email}>`);
    });

    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: `Add ${newContacts.length} contacts?`,
        default: true
      }
    ]);

    if (!confirm) {
      console.log(chalk.yellow('Cancelled'));
      return;
    }

    // Load existing contacts
    const existingContacts = await contactsService.loadContacts();
    const contactMap = new Map<string, Contact>();

    // Add existing contacts
    existingContacts.forEach(contact => {
      contactMap.set(contact.email.toLowerCase(), contact);
    });

    // Add new contacts
    let added = 0;
    let skipped = 0;
    newContacts.forEach(newContact => {
      const key = newContact.email.toLowerCase();
      if (contactMap.has(key)) {
        skipped++;
      } else {
        contactMap.set(key, newContact);
        added++;
      }
    });

    // Save contacts
    await contactsService.saveContacts(Array.from(contactMap.values()));

    console.log(chalk.green(`✓ Added ${added} contacts`));
    if (skipped > 0) {
      console.log(chalk.yellow(`  (${skipped} already existed)`));
    }
  } catch (error: any) {
    console.error(chalk.red('Failed to add contacts:'), error.message || error);
    process.exit(1);
  }
}