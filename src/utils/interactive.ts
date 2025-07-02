import inquirer from 'inquirer';
import autocompletePrompt from 'inquirer-autocomplete-prompt';
import { Contact } from '../types/contact.js';
import { ContactsService } from '../services/contacts.js';

// Inquirerにautocompleteプロンプトを登録
inquirer.registerPrompt('autocomplete', autocompletePrompt);

export async function selectUser(): Promise<string | null> {
  const contactsService = new ContactsService();
  const contacts = await contactsService.getRecentContacts();

  if (contacts.length === 0) {
    console.log('No contacts found. Please enter email address manually.');
    const { email } = await inquirer.prompt([
      {
        type: 'input',
        name: 'email',
        message: 'Enter email address:',
        validate: (input: string) => {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          return emailRegex.test(input) || 'Please enter a valid email address';
        }
      }
    ]);
    return email;
  }

  const { selectedUser } = await inquirer.prompt([
    {
      type: 'autocomplete',
      name: 'selectedUser',
      message: 'Select a person:',
      source: async (_: any, input: string) => {
        if (!input) {
          return contacts.map(formatContactChoice);
        }
        
        const filtered = await contactsService.searchContacts(input);
        return filtered.map(formatContactChoice);
      },
      pageSize: 10
    }
  ]);

  return selectedUser;
}

function formatContactChoice(contact: Contact) {
  const aliasText = contact.alias ? ` (@${contact.alias})` : '';
  const tagsText = contact.tags?.length ? ` [${contact.tags.join(', ')}]` : '';
  const freqText = contact.frequency ? ` (${contact.frequency}x)` : '';
  
  return {
    name: `${contact.name}${aliasText} <${contact.email}>${tagsText}${freqText}`,
    value: contact.email,
    short: contact.name
  };
}