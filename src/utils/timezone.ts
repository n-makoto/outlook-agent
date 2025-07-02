/**
 * Timezone utilities for handling JST times in different environments
 */

import { format as dateFnsFormat } from 'date-fns';

/**
 * Creates a Date object for a specific time in JST
 * @param dateStr Date string in YYYY-MM-DD format
 * @param hour Hour in JST (0-23)
 * @param minute Minute (0-59)
 * @returns Date object representing the time in UTC
 */
export function createJSTDate(dateStr: string, hour: number, minute: number = 0): Date {
  // JST is UTC+9, so subtract 9 hours for UTC
  const utcHour = hour - 9;
  
  if (utcHour < 0) {
    // Previous day in UTC
    const date = new Date(dateStr);
    date.setDate(date.getDate() - 1);
    const prevDateStr = date.toISOString().split('T')[0];
    return new Date(`${prevDateStr}T${24 + utcHour}:${minute.toString().padStart(2, '0')}:00Z`);
  } else {
    return new Date(`${dateStr}T${utcHour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}:00Z`);
  }
}

/**
 * Formats a Date object to display in JST
 * @param date Date object
 * @param formatStr date-fns format string
 * @returns Formatted string in JST
 */
export function formatJST(date: Date, formatStr: string): string {
  // Add 9 hours to convert UTC to JST for display
  const jstTime = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  // Use the UTC methods to avoid local timezone conversion
  const year = jstTime.getUTCFullYear();
  const month = jstTime.getUTCMonth();
  const day = jstTime.getUTCDate();
  const hours = jstTime.getUTCHours();
  const minutes = jstTime.getUTCMinutes();
  const seconds = jstTime.getUTCSeconds();
  
  // Create a new date with these values in local time for formatting
  const displayDate = new Date(year, month, day, hours, minutes, seconds);
  return dateFnsFormat(displayDate, formatStr);
}

/**
 * Gets the JST date string (YYYY-MM-DD) for a given Date
 * @param date Date object
 * @returns Date string in JST
 */
export function getJSTDateString(date: Date): string {
  const jstTime = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return jstTime.toISOString().split('T')[0];
}

/**
 * Checks if two dates are the same day in JST
 * @param date1 First date
 * @param date2 Second date
 * @returns true if same day in JST
 */
export function isSameDayJST(date1: Date, date2: Date): boolean {
  return getJSTDateString(date1) === getJSTDateString(date2);
}