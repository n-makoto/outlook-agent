import chalk from 'chalk';
import { CalendarEvent } from '../types/calendar.js';
import { formatJST } from './timezone.js';

export function formatEvent(event: CalendarEvent): string {
  // UTCとして解釈してJSTで表示
  const startTime = formatJST(new Date(event.start.dateTime + 'Z'), 'HH:mm');
  const endTime = formatJST(new Date(event.end.dateTime + 'Z'), 'HH:mm');
  
  const time = event.isAllDay ? chalk.gray('All day') : chalk.green(`${startTime}-${endTime}`);
  const subject = chalk.bold(event.subject);
  const location = event.location?.displayName ? chalk.gray(` @ ${event.location.displayName}`) : '';
  
  return `${time} ${subject}${location}`;
}