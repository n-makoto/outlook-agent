import { ContactsService } from '../../services/contacts.js';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import { Contact } from '../../types/contact.js';
import inquirer from 'inquirer';

export async function importContacts(filename?: string, options: { merge?: boolean; format?: string } = {}): Promise<void> {
  const contactsService = new ContactsService();

  try {
    // If no filename provided, prompt for it
    if (!filename) {
      const { inputFile } = await inquirer.prompt([
        {
          type: 'input',
          name: 'inputFile',
          message: 'File to import:',
          validate: (input: string) => input.length > 0 || 'Filename is required'
        }
      ]);
      filename = inputFile;
    }

    console.log(chalk.blue(`Importing contacts from ${filename}...`));
    
    // Read file
    const content = await fs.readFile(filename!, 'utf-8');
    
    // Parse based on format
    const format = options.format?.toLowerCase() || (filename!.endsWith('.csv') ? 'csv' : 'json');
    let newContacts: Contact[] = [];

    if (format === 'json') {
      // Parse JSON
      try {
        const data = JSON.parse(content);
        if (Array.isArray(data)) {
          newContacts = data.filter(item => 
            item.email && typeof item.email === 'string'
          );
        } else {
          console.error(chalk.red('Invalid JSON format: expected an array of contacts'));
          return;
        }
      } catch (error) {
        console.error(chalk.red('Invalid JSON file'));
        return;
      }
    } else if (format === 'csv') {
      // Parse CSV
      const lines = content.trim().split('\n');
      if (lines.length < 2) {
        console.error(chalk.red('CSV file must have at least header and one data row'));
        return;
      }

      // Parse header
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      const emailIndex = headers.indexOf('email');
      const nameIndex = headers.indexOf('name');
      const aliasIndex = headers.indexOf('alias');
      const tagsIndex = headers.indexOf('tags');
      const frequencyIndex = headers.indexOf('frequency');

      if (emailIndex === -1) {
        console.error(chalk.red('CSV must have an "email" column'));
        return;
      }

      // Parse data rows
      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length > emailIndex && values[emailIndex]) {
          const contact: Contact = {
            email: values[emailIndex],
            name: nameIndex !== -1 ? values[nameIndex] || values[emailIndex] : values[emailIndex]
          };

          if (aliasIndex !== -1 && values[aliasIndex]) {
            contact.alias = values[aliasIndex];
          }

          if (tagsIndex !== -1 && values[tagsIndex]) {
            contact.tags = values[tagsIndex].split(';').map(t => t.trim()).filter(t => t);
          }

          if (frequencyIndex !== -1 && values[frequencyIndex]) {
            contact.frequency = parseInt(values[frequencyIndex]) || 0;
          }

          newContacts.push(contact);
        }
      }
    } else {
      console.error(chalk.red(`Unsupported format: ${format}. Use 'json' or 'csv'`));
      return;
    }

    if (newContacts.length === 0) {
      console.log(chalk.yellow('No valid contacts found in file'));
      return;
    }

    // Load existing contacts
    const existingContacts = await contactsService.loadContacts();
    
    // Merge strategy
    let finalContacts: Contact[];
    if (options.merge) {
      // Merge with existing contacts
      const contactMap = new Map<string, Contact>();
      
      // Add existing contacts
      existingContacts.forEach(contact => {
        contactMap.set(contact.email.toLowerCase(), contact);
      });

      // Merge new contacts
      let updated = 0;
      let added = 0;
      newContacts.forEach(newContact => {
        const key = newContact.email.toLowerCase();
        if (contactMap.has(key)) {
          // Update existing contact
          const existing = contactMap.get(key)!;
          existing.name = newContact.name || existing.name;
          existing.alias = newContact.alias || existing.alias;
          
          // Merge tags
          if (newContact.tags) {
            const tagSet = new Set([...(existing.tags || []), ...newContact.tags]);
            existing.tags = Array.from(tagSet);
          }
          
          // Keep higher frequency
          existing.frequency = Math.max(existing.frequency || 0, newContact.frequency || 0);
          updated++;
        } else {
          // Add new contact
          contactMap.set(key, newContact);
          added++;
        }
      });

      finalContacts = Array.from(contactMap.values());
      console.log(chalk.green(`✓ Imported ${added} new contacts, updated ${updated} existing contacts`));
    } else {
      // Replace all contacts
      const { confirmReplace } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmReplace',
          message: `This will replace all ${existingContacts.length} existing contacts with ${newContacts.length} new contacts. Continue?`,
          default: false
        }
      ]);

      if (!confirmReplace) {
        console.log(chalk.yellow('Import cancelled'));
        return;
      }

      finalContacts = newContacts;
      console.log(chalk.green(`✓ Imported ${newContacts.length} contacts (replaced existing)`));
    }

    // Save contacts
    await contactsService.saveContacts(finalContacts);
    console.log(chalk.green(`Total contacts: ${finalContacts.length}`));
  } catch (error: any) {
    console.error(chalk.red('Failed to import contacts:'), error.message || error);
    process.exit(1);
  }
}

// Simple CSV parser that handles quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = i < line.length - 1 ? line[i + 1] : '';
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next character
      } else {
        // Toggle quote mode
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  
  // Add last field
  result.push(current.trim());
  
  return result;
}