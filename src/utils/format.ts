import chalk from 'chalk';
import { CalendarEvent } from '../types/calendar.js';
import { formatJST } from './timezone.js';

export function formatEvent(event: CalendarEvent, options?: { showDate?: boolean }): string {
  // タイムゾーン処理
  const startDateTime = event.start.timeZone === 'Asia/Tokyo'
    ? event.start.dateTime + '+09:00'
    : event.start.dateTime + 'Z';
  const endDateTime = event.end.timeZone === 'Asia/Tokyo'
    ? event.end.dateTime + '+09:00'
    : event.end.dateTime + 'Z';

  const startDate = new Date(startDateTime);
  const endDate = new Date(endDateTime);

  const date = options?.showDate ? chalk.cyan(formatJST(startDate, 'MM/dd(EEE)')) + ' ' : '';
  const startTime = formatJST(startDate, 'HH:mm');
  const endTime = formatJST(endDate, 'HH:mm');

  const time = event.isAllDay ? chalk.gray('All day') : chalk.green(`${startTime}-${endTime}`);
  const subject = chalk.bold(event.subject);
  const location = event.location?.displayName ? chalk.gray(` @ ${event.location.displayName}`) : '';

  return `${date}${time} ${subject}${location}`;
}

export function formatDateTimeRange(start: Date, end: Date): string {
  const startStr = formatJST(start, 'EEE, MMM d HH:mm');
  const endStr = formatJST(end, 'HH:mm');
  return `${startStr} - ${endStr}`;
}