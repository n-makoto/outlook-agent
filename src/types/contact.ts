export interface Contact {
  email: string;
  name: string;
  alias?: string;
  tags?: string[];
  lastUsed?: Date;
  frequency?: number;
}

export interface ContactGroup {
  id: string;
  displayName: string;
  members: Contact[];
}