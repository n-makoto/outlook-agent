import { CalendarEvent } from './calendar.js';

export interface EventConflict {
  events: CalendarEvent[];
  startTime: Date;
  endTime: Date;
}

export interface ConflictResolution {
  eventId: string;
  action: 'attend' | 'decline' | 'reschedule';
  declineMessage?: string;
}