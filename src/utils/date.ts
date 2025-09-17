import { format, startOfDay, endOfDay } from 'date-fns';

export function getToday(): { start: string; end: string } {
  const now = new Date();
  const start = startOfDay(now);
  const end = endOfDay(now);
  
  const offset = now.getTimezoneOffset();
  const offsetHours = Math.abs(Math.floor(offset / 60));
  const offsetMinutes = Math.abs(offset % 60);
  const offsetSign = offset <= 0 ? '+' : '-';
  const offsetString = `${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;
  
  return {
    start: format(start, 'yyyy-MM-dd\'T\'HH:mm:ss') + offsetString,
    end: format(end, 'yyyy-MM-dd\'T\'HH:mm:ss') + offsetString
  };
}