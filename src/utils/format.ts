import chalk from 'chalk';
import { format } from 'date-fns';
import { CalendarEvent } from '../types/calendar.js';

export function formatEvent(event: CalendarEvent): string {
  const startTime = format(new Date(event.start.dateTime), 'HH:mm');
  const endTime = format(new Date(event.end.dateTime), 'HH:mm');
  
  const time = event.isAllDay ? chalk.gray('All day') : chalk.green(`${startTime}-${endTime}`);
  const subject = chalk.bold(event.subject);
  const location = event.location?.displayName ? chalk.gray(` @ ${event.location.displayName}`) : '';
  
  return `${time} ${subject}${location}`;
}