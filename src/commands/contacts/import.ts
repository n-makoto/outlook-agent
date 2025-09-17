import { ContactsService } from '../../services/contacts.js';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import { Contact } from '../../types/contact.js';
import inquirer from 'inquirer';

interface ImportOptions {
  merge?: boolean;
  format?: string;
}

interface MergeResult {
  contacts: Contact[];
  added: number;
  updated: number;
}

async function promptForFilename(): Promise<string> {
  const { inputFile } = await inquirer.prompt([
    {
      type: 'input',
      name: 'inputFile',
      message: 'File to import:',
      validate: (input: string) => input.length > 0 || 'Filename is required'
    }
  ]);
  return inputFile;
}

async function parseContactsFile(
  filename: string,
  options: ImportOptions
): Promise<Contact[]> {
  const content = await fs.readFile(filename, 'utf-8');
  const format = options.format?.toLowerCase() || (filename.endsWith('.csv') ? 'csv' : 'json');
  
  if (format === 'json') {
    return parseJsonContacts(content);
  } else if (format === 'csv') {
    return parseCsvContacts(content);
  } else {
    throw new Error(`Unsupported format: ${format}. Use 'json' or 'csv'`);
  }
}

function parseJsonContacts(content: string): Contact[] {
  try {
    const data = JSON.parse(content);
    if (Array.isArray(data)) {
      return data.filter(item => 
        item.email && typeof item.email === 'string'
      );
    } else {
      throw new Error('Invalid JSON format: expected an array of contacts');
    }
  } catch (error) {
    throw new Error('Invalid JSON file');
  }
}

function parseCsvContacts(content: string): Contact[] {
  const lines = content.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('CSV file must have at least header and one data row');
  }
  
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const columnIndices = getColumnIndices(headers);
  
  if (columnIndices.emailIndex === -1) {
    throw new Error('CSV must have an "email" column');
  }
  
  const contacts: Contact[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const contact = parseContactFromCsvLine(lines[i], columnIndices);
    if (contact) {
      contacts.push(contact);
    }
  }
  
  return contacts;
}

function getColumnIndices(headers: string[]): {
  emailIndex: number;
  nameIndex: number;
  aliasIndex: number;
  tagsIndex: number;
  frequencyIndex: number;
} {
  return {
    emailIndex: headers.indexOf('email'),
    nameIndex: headers.indexOf('name'),
    aliasIndex: headers.indexOf('alias'),
    tagsIndex: headers.indexOf('tags'),
    frequencyIndex: headers.indexOf('frequency')
  };
}

function parseContactFromCsvLine(
  line: string,
  indices: ReturnType<typeof getColumnIndices>
): Contact | null {
  const values = parseCSVLine(line);
  
  if (values.length <= indices.emailIndex || !values[indices.emailIndex]) {
    return null;
  }
  
  const contact: Contact = {
    email: values[indices.emailIndex],
    name: indices.nameIndex !== -1 ? values[indices.nameIndex] || values[indices.emailIndex] : values[indices.emailIndex]
  };
  
  if (indices.aliasIndex !== -1 && values[indices.aliasIndex]) {
    contact.alias = values[indices.aliasIndex];
  }
  
  if (indices.tagsIndex !== -1 && values[indices.tagsIndex]) {
    contact.tags = values[indices.tagsIndex].split(';').map(t => t.trim()).filter(t => t);
  }
  
  if (indices.frequencyIndex !== -1 && values[indices.frequencyIndex]) {
    contact.frequency = parseInt(values[indices.frequencyIndex]) || 0;
  }
  
  return contact;
}

function mergeContacts(
  newContacts: Contact[],
  existingContacts: Contact[]
): MergeResult {
  const contactMap = new Map<string, Contact>();
  
  existingContacts.forEach(contact => {
    contactMap.set(contact.email.toLowerCase(), contact);
  });
  
  let updated = 0;
  let added = 0;
  
  newContacts.forEach(newContact => {
    const key = newContact.email.toLowerCase();
    if (contactMap.has(key)) {
      const existing = contactMap.get(key)!;
      mergeContactData(existing, newContact);
      updated++;
    } else {
      contactMap.set(key, newContact);
      added++;
    }
  });
  
  return {
    contacts: Array.from(contactMap.values()),
    added,
    updated
  };
}

function mergeContactData(existing: Contact, newContact: Contact): void {
  existing.name = newContact.name || existing.name;
  existing.alias = newContact.alias || existing.alias;
  
  if (newContact.tags) {
    const tagSet = new Set([...(existing.tags || []), ...newContact.tags]);
    existing.tags = Array.from(tagSet);
  }
  
  existing.frequency = Math.max(existing.frequency || 0, newContact.frequency || 0);
}

async function confirmAndReplaceContacts(
  newContacts: Contact[],
  existingContacts: Contact[]
): Promise<Contact[] | null> {
  const { confirmReplace } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmReplace',
      message: `This will replace all ${existingContacts.length} existing contacts with ${newContacts.length} new contacts. Continue?`,
      default: false
    }
  ]);
  
  if (!confirmReplace) {
    return null;
  }
  
  return newContacts;
}

export async function importContacts(
  filename?: string,
  options: ImportOptions = {}
): Promise<void> {
  const contactsService = new ContactsService();

  try {
    if (!filename) {
      filename = await promptForFilename();
    }

    console.log(chalk.blue(`Importing contacts from ${filename}...`));
    
    const newContacts = await parseContactsFile(filename, options);
    
    if (newContacts.length === 0) {
      console.log(chalk.yellow('No valid contacts found in file'));
      return;
    }

    const existingContacts = await contactsService.loadContacts();
    let finalContacts: Contact[];
    
    if (options.merge) {
      const result = mergeContacts(newContacts, existingContacts);
      finalContacts = result.contacts;
      console.log(chalk.green(`✓ Imported ${result.added} new contacts, updated ${result.updated} existing contacts`));
    } else {
      const replacedContacts = await confirmAndReplaceContacts(newContacts, existingContacts);
      if (!replacedContacts) {
        console.log(chalk.yellow('Import cancelled'));
        return;
      }
      finalContacts = replacedContacts;
      console.log(chalk.green(`✓ Imported ${newContacts.length} contacts (replaced existing)`));
    }

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