import { describe, it, expect } from 'vitest';
import { ConflictFilter } from './conflict-filter.js';
import { EventConflict } from '../types/conflict.js';
import { CalendarEvent } from '../types/calendar.js';

describe('ConflictFilter', () => {
  const createMockEvent = (subject: string): CalendarEvent => ({
    id: `event-${subject}`,
    subject,
    start: { dateTime: '2025-01-20T10:00:00', timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2025-01-20T11:00:00', timeZone: 'Asia/Tokyo' },
    organizer: { emailAddress: { address: 'test@example.com', name: 'Test User' } },
    attendees: [],
    showAs: 'busy',
    isAllDay: false,
    isCancelled: false
  });

  const createMockConflict = (
    events: CalendarEvent[],
    date: string = '2025-01-20T10:00:00'
  ): EventConflict => ({
    events,
    startTime: new Date(date),
    endTime: new Date(new Date(date).getTime() + 60 * 60 * 1000)
  });

  describe('filterConflicts', () => {
    it('should return all conflicts when no ignore rules', () => {
      const filter = new ConflictFilter({});
      const conflicts = [
        createMockConflict([createMockEvent('Meeting 1'), createMockEvent('Meeting 2')])
      ];
      
      const result = filter.filterConflicts(conflicts);
      expect(result).toHaveLength(1);
    });

    it('should filter conflicts based on day_of_week rule', () => {
      const filter = new ConflictFilter({
        custom_rules: {
          ignore_conflicts: [{
            description: 'Ignore Monday conflicts',
            conditions: [{ day_of_week: 'Monday' }]
          }]
        }
      });
      
      // Monday conflict (2025-01-20 is Monday)
      const mondayConflict = createMockConflict(
        [createMockEvent('Monday Meeting 1'), createMockEvent('Monday Meeting 2')],
        '2025-01-20T10:00:00'
      );
      
      // Tuesday conflict
      const tuesdayConflict = createMockConflict(
        [createMockEvent('Tuesday Meeting 1'), createMockEvent('Tuesday Meeting 2')],
        '2025-01-21T10:00:00'
      );
      
      const result = filter.filterConflicts([mondayConflict, tuesdayConflict]);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(tuesdayConflict);
    });

    it('should filter conflicts based on event patterns', () => {
      const filter = new ConflictFilter({
        custom_rules: {
          ignore_conflicts: [{
            description: 'Ignore standup conflicts',
            conditions: [{
              event1_pattern: 'Standup',
              event2_pattern: 'Team Sync'
            }]
          }]
        }
      });
      
      const standupConflict = createMockConflict([
        createMockEvent('Daily Standup'),
        createMockEvent('Team Sync Meeting')
      ]);
      
      const regularConflict = createMockConflict([
        createMockEvent('Project Review'),
        createMockEvent('Client Meeting')
      ]);
      
      const result = filter.filterConflicts([standupConflict, regularConflict]);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(regularConflict);
    });

    it('should handle multiple conditions in a single rule', () => {
      const filter = new ConflictFilter({
        custom_rules: {
          ignore_conflicts: [{
            description: 'Ignore specific Monday standup',
            conditions: [
              { day_of_week: 'Monday' },
              { time: '10:00' }
            ]
          }]
        }
      });
      
      // Monday 10:00 conflict
      const mondayMorning = createMockConflict(
        [createMockEvent('Meeting 1'), createMockEvent('Meeting 2')],
        '2025-01-20T10:00:00'
      );
      
      // Monday 14:00 conflict
      const mondayAfternoon = createMockConflict(
        [createMockEvent('Meeting 3'), createMockEvent('Meeting 4')],
        '2025-01-20T14:00:00'
      );
      
      const result = filter.filterConflicts([mondayMorning, mondayAfternoon]);
      expect(result).toHaveLength(1);
      expect(result[0]).toBe(mondayAfternoon);
    });
  });
});