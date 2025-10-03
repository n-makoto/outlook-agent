import { format, startOfDay, endOfDay, addDays, parseISO } from 'date-fns';

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

export function getDateRange(options: {
  date?: string;
  start?: string;
  end?: string;
  days?: number;
}): { start: string; end: string } {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const offsetHours = Math.abs(Math.floor(offset / 60));
  const offsetMinutes = Math.abs(offset % 60);
  const offsetSign = offset <= 0 ? '+' : '-';
  const offsetString = `${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;

  // --start と --end が指定されている場合
  if (options.start && options.end) {
    const startDate = startOfDay(parseISO(options.start));
    const endDate = endOfDay(parseISO(options.end));
    return {
      start: format(startDate, 'yyyy-MM-dd\'T\'HH:mm:ss') + offsetString,
      end: format(endDate, 'yyyy-MM-dd\'T\'HH:mm:ss') + offsetString
    };
  }

  // --days が指定されている場合（今日から指定日数分）
  if (options.days) {
    const startDate = startOfDay(now);
    const endDate = endOfDay(addDays(now, options.days - 1));
    return {
      start: format(startDate, 'yyyy-MM-dd\'T\'HH:mm:ss') + offsetString,
      end: format(endDate, 'yyyy-MM-dd\'T\'HH:mm:ss') + offsetString
    };
  }

  // --date が指定されている場合（特定の日）
  if (options.date) {
    const targetDate = parseISO(options.date);
    const startDate = startOfDay(targetDate);
    const endDate = endOfDay(targetDate);
    return {
      start: format(startDate, 'yyyy-MM-dd\'T\'HH:mm:ss') + offsetString,
      end: format(endDate, 'yyyy-MM-dd\'T\'HH:mm:ss') + offsetString
    };
  }

  // 何も指定されていない場合は今日
  return getToday();
}