import chalk from 'chalk';
import { CalendarEvent } from '../types/calendar.js';
import { formatJST } from './timezone.js';

export function formatEvent(event: CalendarEvent): string {
  // タイムゾーン処理
  const startDateTime = event.start.timeZone === 'Asia/Tokyo' 
    ? event.start.dateTime + '+09:00'
    : event.start.dateTime + 'Z';
  const endDateTime = event.end.timeZone === 'Asia/Tokyo'
    ? event.end.dateTime + '+09:00'
    : event.end.dateTime + 'Z';
    
  const startTime = formatJST(new Date(startDateTime), 'HH:mm');
  const endTime = formatJST(new Date(endDateTime), 'HH:mm');
  
  const time = event.isAllDay ? chalk.gray('All day') : chalk.green(`${startTime}-${endTime}`);
  const subject = chalk.bold(event.subject);
  const location = event.location?.displayName ? chalk.gray(` @ ${event.location.displayName}`) : '';
  
  return `${time} ${subject}${location}`;
}

export function formatDateTimeRange(start: Date, end: Date): string {
  const startStr = formatJST(start, 'EEE, MMM d HH:mm');
  const endStr = formatJST(end, 'HH:mm');
  return `${startStr} - ${endStr}`;
}