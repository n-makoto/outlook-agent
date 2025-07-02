import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';
import chalk from 'chalk';
import { Contact } from '../types/contact.js';
import { MgcService } from './mgc.js';

export class ContactsService {
  private configDir = path.join(homedir(), '.outlook-agent');
  private contactsFile = path.join(this.configDir, 'contacts.json');
  private cacheFile = path.join(this.configDir, 'contacts-cache.json');
  private mgc = new MgcService();
  private contactsCache: Contact[] | null = null;

  async ensureConfigDir(): Promise<void> {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch (error) {
      console.error('Failed to create config directory:', error);
    }
  }

  async loadContacts(): Promise<Contact[]> {
    await this.ensureConfigDir();
    try {
      const data = await fs.readFile(this.contactsFile, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // ファイルが存在しない場合は空配列を返す
      return [];
    }
  }

  async saveContacts(contacts: Contact[]): Promise<void> {
    await this.ensureConfigDir();
    await fs.writeFile(this.contactsFile, JSON.stringify(contacts, null, 2));
  }

  async loadContactsCache(): Promise<{ contacts: Contact[]; timestamp: number } | null> {
    try {
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async saveContactsCache(contacts: Contact[]): Promise<void> {
    await this.ensureConfigDir();
    const cache = {
      contacts,
      timestamp: Date.now()
    };
    await fs.writeFile(this.cacheFile, JSON.stringify(cache, null, 2));
  }

  async getRecentContacts(): Promise<Contact[]> {
    // メモリキャッシュをチェック
    if (this.contactsCache) {
      return this.contactsCache;
    }

    // ファイルキャッシュをチェック
    const cache = await this.loadContactsCache();
    const ONE_HOUR = 60 * 60 * 1000;
    
    // キャッシュが存在する場合は、古くても一旦返す
    if (cache && cache.contacts.length > 0) {
      this.contactsCache = cache.contacts;
      
      // 1時間以上経過していたらバックグラウンドで更新
      if (Date.now() - cache.timestamp > ONE_HOUR) {
        this.refreshContactsInBackground();
      }
      
      return cache.contacts;
    }

    // キャッシュが全くない場合は初回取得（同期的に実行）
    console.log(chalk.gray('Loading contacts for the first time...'));
    const contactMap = new Map<string, Contact>();

    // ローカルの連絡先を最初に読み込む（高速）
    const localContacts = await this.loadContacts();
    localContacts.forEach(contact => {
      contactMap.set(contact.email.toLowerCase(), contact);
    });

    // 初回は同期的にイベントから連絡先を取得
    await this.updateContactsFromEvents(contactMap);

    // 連絡先を保存して返す
    const contacts = Array.from(contactMap.values())
      .sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
    
    this.contactsCache = contacts;
    await this.saveContactsCache(contacts);
    
    return contacts;
  }

  private async refreshContactsInBackground(): Promise<void> {
    // バックグラウンドでキャッシュを更新
    const contactMap = new Map<string, Contact>();
    
    const localContacts = await this.loadContacts();
    localContacts.forEach(contact => {
      contactMap.set(contact.email.toLowerCase(), contact);
    });
    
    await this.updateContactsFromEvents(contactMap);
    
    const updatedContacts = Array.from(contactMap.values())
      .sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
    
    this.contactsCache = updatedContacts;
    await this.saveContactsCache(updatedContacts);
  }

  private async updateContactsFromEvents(contactMap: Map<string, Contact>): Promise<void> {
    try {
      const events = await this.mgc.getRecentEventsWithAttendees();
      
      events.forEach(event => {
        event.attendees?.forEach(attendee => {
          const email = attendee.emailAddress.address;
          const lowerEmail = email.toLowerCase();
          
          if (!contactMap.has(lowerEmail)) {
            contactMap.set(lowerEmail, {
              email, // 元のケースを保持
              name: attendee.emailAddress.name || email,
              frequency: 1
            });
          } else {
            const contact = contactMap.get(lowerEmail)!;
            contact.frequency = (contact.frequency || 0) + 1;
            // 元のemailアドレスのケースを保持
            if (!contact.email) {
              contact.email = email;
            }
          }
        });
      });

      // 更新された連絡先を保存
      const updatedContacts = Array.from(contactMap.values())
        .sort((a, b) => (b.frequency || 0) - (a.frequency || 0));
      
      this.contactsCache = updatedContacts;
      await this.saveContactsCache(updatedContacts);
    } catch (error) {
      console.error('Failed to update contacts from events:', error);
    }
  }

  async searchContacts(query: string): Promise<Contact[]> {
    const contacts = await this.getRecentContacts();
    const lowerQuery = query.toLowerCase();
    
    return contacts.filter(contact => 
      contact.name.toLowerCase().includes(lowerQuery) ||
      contact.email.toLowerCase().includes(lowerQuery) ||
      contact.alias?.toLowerCase().includes(lowerQuery) ||
      contact.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  async syncWithOutlookGroup(groupName: string): Promise<void> {
    // Outlookの連絡先グループを取得
    const groups = await this.mgc.getContactGroups();
    const targetGroup = groups.find(g => 
      g.displayName.toLowerCase() === groupName.toLowerCase()
    );

    if (!targetGroup) {
      throw new Error(`Contact group "${groupName}" not found`);
    }

    // グループのメンバーを取得
    const members = await this.mgc.getContactGroupMembers(targetGroup.id);
    
    // Contactフォーマットに変換
    const outlookContacts: Contact[] = members.map(member => ({
      email: member.emailAddresses?.[0]?.address || '',
      name: member.displayName || member.emailAddresses?.[0]?.name || '',
      tags: [groupName]
    })).filter(c => c.email); // メールアドレスがないものは除外

    // ローカルの連絡先を読み込み
    const localContacts = await this.loadContacts();
    
    // マージ処理
    const contactMap = new Map<string, Contact>();
    
    // 既存の連絡先を保持
    localContacts.forEach(contact => {
      contactMap.set(contact.email.toLowerCase(), contact);
    });

    // Outlookの連絡先を追加/更新
    outlookContacts.forEach(outlookContact => {
      const email = outlookContact.email.toLowerCase();
      if (contactMap.has(email)) {
        // 既存の連絡先にタグを追加
        const existing = contactMap.get(email)!;
        const tags = new Set(existing.tags || []);
        tags.add(groupName);
        existing.tags = Array.from(tags);
      } else {
        // 新規追加
        contactMap.set(email, outlookContact);
      }
    });

    // 保存
    await this.saveContacts(Array.from(contactMap.values()));
  }

  async listContactGroups(): Promise<{ id: string; displayName: string }[]> {
    return await this.mgc.getContactGroups();
  }
}