import { MgcService } from '../../services/mgc.js';
import { selectUser } from '../../utils/interactive.js';
import { format, addDays, addMinutes } from 'date-fns';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { CalendarEvent } from '../../types/calendar.js';
import { isWorkday } from '../../utils/holidays.js';
import { createJSTDate, formatJST, isSameDayJST } from '../../utils/timezone.js';

interface TimeSlotCandidate {
  date: Date;
  start: Date;
  end: Date;
}

interface EventData {
  subject: string;
  attendees: Array<{ emailAddress: { address: string } }>;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  location?: {
    displayName: string;
  };
}

async function handleNonInteractiveMode(
  options: { subject: string; attendees: string[]; duration?: number; outputFormat?: 'json' | 'text' },
  mgc: MgcService
): Promise<void> {
  const duration = options.duration || 30;
  const candidates = await findAvailableTimeSlots(mgc, options.attendees, duration);
  
  outputAvailableSlots(candidates, options.subject, options.attendees, duration, options.outputFormat);
}

async function findAvailableTimeSlots(
  mgc: MgcService,
  attendeeEmails: string[],
  duration: number
): Promise<TimeSlotCandidate[]> {
  const now = new Date();
  const alignedNow = new Date(now);
  alignedNow.setMinutes(Math.floor(alignedNow.getMinutes() / 30) * 30, 0, 0);
  
  const searchDays = 14;
  const endSearchDate = addDays(alignedNow, searchDays);
  
  const startDateStr = format(now, 'yyyy-MM-dd');
  const endDateStr = format(endSearchDate, 'yyyy-MM-dd');
  
  const [myEvents, freeBusyResult] = await Promise.all([
    mgc.getMyCalendarEvents(
      `${startDateStr}T00:00:00+09:00`,
      `${endDateStr}T23:59:59+09:00`
    ).catch(() => [] as CalendarEvent[]),
    mgc.getUserFreeBusy(
      attendeeEmails,
      alignedNow.toISOString(),
      endSearchDate.toISOString()
    )
  ]);
  
  const candidates: TimeSlotCandidate[] = [];
  
  for (let i = 0; i < searchDays; i++) {
    const date = addDays(now, i);
    
    if (!isWorkday(date)) {continue;}
    
    const daySlots = findDaySlots(date, now, duration, myEvents, freeBusyResult, alignedNow, i);
    candidates.push(...daySlots);
  }
  
  return candidates;
}

function findDaySlots(
  date: Date,
  now: Date,
  duration: number,
  myEvents: CalendarEvent[],
  freeBusyResult: any,
  alignedNow: Date,
  dayIndex: number
): TimeSlotCandidate[] {
  const dateStr = format(date, 'yyyy-MM-dd');
  const candidates: TimeSlotCandidate[] = [];
  
  let searchStartTime = createJSTDate(dateStr, 9, 0);
  const searchEndTime = createJSTDate(dateStr, 19, 0);
  
  if (dayIndex === 0) {
    const minStartTime = addMinutes(now, 30);
    if (minStartTime > searchStartTime) {
      searchStartTime = minStartTime;
    }
  }
  
  let currentTime = new Date(searchStartTime);
  while (currentTime < searchEndTime && addMinutes(currentTime, duration) <= searchEndTime) {
    const slotEnd = addMinutes(currentTime, duration);
    
    if (isSlotAvailable(currentTime, slotEnd, myEvents, freeBusyResult, alignedNow)) {
      candidates.push({
        date: date,
        start: new Date(currentTime),
        end: new Date(slotEnd)
      });
    }
    
    currentTime = addMinutes(currentTime, 30);
  }
  
  return candidates;
}

function isSlotAvailable(
  currentTime: Date,
  slotEnd: Date,
  myEvents: CalendarEvent[],
  freeBusyResult: any,
  alignedNow: Date
): boolean {
  return checkMyCalendarAvailability(currentTime, slotEnd, myEvents) &&
         checkAttendeeAvailability(currentTime, freeBusyResult, alignedNow);
}

function checkMyCalendarAvailability(
  currentTime: Date,
  slotEnd: Date,
  myEvents: CalendarEvent[]
): boolean {
  for (const event of myEvents) {
    if (event.subject?.startsWith('Declined:')) {
      continue;
    }
    
    const startDateTime = event.start.timeZone === 'Asia/Tokyo' 
      ? event.start.dateTime + '+09:00'
      : event.start.dateTime + 'Z';
    const endDateTime = event.end.timeZone === 'Asia/Tokyo'
      ? event.end.dateTime + '+09:00'
      : event.end.dateTime + 'Z';
      
    const eventStart = new Date(startDateTime);
    const eventEnd = new Date(endDateTime);
    
    if (!isSameDayJST(eventStart, currentTime) && !isSameDayJST(eventEnd, currentTime)) {
      continue;
    }
    
    if (event.isAllDay && isSameDayJST(eventStart, currentTime)) {
      if (event.showAs !== 'free') {
        return false;
      }
    }
    
    if (hasTimeConflict(currentTime, slotEnd, eventStart, eventEnd)) {
      if (event.showAs !== 'free') {
        return false;
      }
    }
  }
  
  return true;
}

function hasTimeConflict(
  slotStart: Date,
  slotEnd: Date,
  eventStart: Date,
  eventEnd: Date
): boolean {
  return (slotStart >= eventStart && slotStart < eventEnd) ||
         (slotEnd > eventStart && slotEnd <= eventEnd) ||
         (slotStart <= eventStart && slotEnd >= eventEnd);
}

function checkAttendeeAvailability(
  currentTime: Date,
  freeBusyResult: any,
  alignedNow: Date
): boolean {
  const schedules = freeBusyResult.value || [];
  
  for (let scheduleIndex = 0; scheduleIndex < schedules.length; scheduleIndex++) {
    const schedule = schedules[scheduleIndex];
    
    if (schedule.availabilityView) {
      const slotStartTime = currentTime.getTime();
      const requestStartTime = alignedNow.getTime();
      const minutesFromStart = (slotStartTime - requestStartTime) / (1000 * 60);
      const slotIndex = Math.floor(minutesFromStart / 30);
      
      if (slotIndex >= 0 && slotIndex < schedule.availabilityView.length) {
        const availability = schedule.availabilityView.charAt(slotIndex);
        
        if (availability !== '0') {
          return false;
        }
      }
    }
  }
  
  return true;
}

function outputAvailableSlots(
  candidates: TimeSlotCandidate[],
  subject: string,
  attendees: string[],
  duration: number,
  outputFormat?: 'json' | 'text'
): void {
  if (outputFormat === 'json') {
    const result = {
      success: candidates.length > 0,
      subject: subject,
      attendees: attendees,
      duration: duration,
      availableSlots: candidates.slice(0, 20).map(c => ({
        date: format(c.date, 'yyyy-MM-dd'),
        start: formatJST(c.start, 'HH:mm'),
        end: formatJST(c.end, 'HH:mm'),
        startISO: c.start.toISOString(),
        endISO: c.end.toISOString()
      }))
    };
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (candidates.length === 0) {
      console.log(chalk.yellow('No available time slots found'));
    } else {
      console.log(chalk.blue(`Found ${candidates.length} available time slots:`));
      candidates.slice(0, 20).forEach((c, i) => {
        console.log(`${i + 1}. ${format(c.date, 'EEE, MMM d')} ${formatJST(c.start, 'HH:mm')}-${formatJST(c.end, 'HH:mm')} JST`);
      });
    }
  }
}

export async function createEvent(options: { 
  findSlot?: boolean;
  interactive?: boolean;
  nonInteractive?: boolean;
  subject?: string;
  attendees?: string[];
  duration?: number;
  outputFormat?: 'json' | 'text';
} = {}): Promise<void> {
  const mgc = new MgcService();

  try {
    if (options.nonInteractive && options.subject && options.attendees && options.attendees.length > 0) {
      await handleNonInteractiveMode({
        subject: options.subject,
        attendees: options.attendees,
        duration: options.duration,
        outputFormat: options.outputFormat
      }, mgc);
      return;
    }

    if (options.interactive || options.findSlot) {
      const eventData = await handleInteractiveMode(options, mgc);
      
      console.log(chalk.blue('Creating event...'));
      const eventId = await mgc.createEvent(eventData);
      
      console.log(chalk.green('✓ Event created successfully!'));
      console.log(chalk.gray(`Event ID: ${eventId}`));
    } else {
      console.log(chalk.yellow('Please use --interactive or --find-slot option'));
    }
  } catch (error: any) {
    handleCreateEventError(error);
  }
}

async function handleInteractiveMode(
  options: { findSlot?: boolean },
  mgc: MgcService
): Promise<EventData> {
  const eventData: Partial<EventData> = {};
  
  const { subject } = await inquirer.prompt([
    {
      type: 'input',
      name: 'subject',
      message: 'Event title:',
      validate: (input: string) => input.length > 0 || 'Title is required'
    }
  ]);
  eventData.subject = subject;
  
  const attendees = await selectAttendees();
  eventData.attendees = attendees;
  
  if (options.findSlot && attendees.length > 0) {
    const timeSlot = await findAndSelectTimeSlot(mgc, attendees);
    eventData.start = timeSlot.start;
    eventData.end = timeSlot.end;
  } else {
    const timeSlot = await promptForManualTime();
    eventData.start = timeSlot.start;
    eventData.end = timeSlot.end;
  }
  
  const location = await promptForLocation();
  if (location) {
    eventData.location = location;
  }
  
  // Ensure all required fields are set
  if (!eventData.subject || !eventData.attendees || !eventData.start || !eventData.end) {
    throw new Error('Failed to collect required event data');
  }
  
  return eventData as EventData;
}

async function selectAttendees(): Promise<Array<{ emailAddress: { address: string } }>> {
  const attendees = [];
  let addMore = true;
  
  while (addMore) {
    console.log(chalk.gray('\nSelect attendee (or press ESC to finish):'));
    const attendeeEmail = await selectUser();
    if (attendeeEmail) {
      attendees.push({ emailAddress: { address: attendeeEmail } });
    }
    
    if (attendees.length > 0) {
      const { continue: shouldContinue } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'continue',
          message: 'Add another attendee?',
          default: false
        }
      ]);
      addMore = shouldContinue;
    } else {
      addMore = true;
    }
  }
  
  return attendees;
}

async function findAndSelectTimeSlot(
  mgc: MgcService,
  attendees: Array<{ emailAddress: { address: string } }>
): Promise<{ start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } }> {
  console.log(chalk.blue('Finding available time slots...'));
  
  const { duration } = await inquirer.prompt([
    {
      type: 'number',
      name: 'duration',
      message: 'Meeting duration (minutes):',
      default: 30,
      validate: (input: number) => input > 0 && input <= 480 || 'Duration must be between 1 and 480 minutes'
    }
  ]);
  
  console.log(chalk.blue('Checking availability...'));
  const attendeeEmails = attendees.map(a => a.emailAddress.address);
  console.log(chalk.gray(`Checking availability for: ${attendeeEmails.join(', ')}`));
  
  const candidates = await findAvailableTimeSlots(mgc, attendeeEmails, duration);
  
  if (candidates.length === 0) {
    console.log(chalk.yellow('No available time slots found in the next 14 days (weekdays only)'));
    throw new Error('No available time slots found');
  }
  
  console.log(chalk.blue(`Found ${candidates.length} available time slots`));
  
  const sortedCandidates = candidates.sort((a, b) => a.start.getTime() - b.start.getTime());
  const { selectedSlot } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedSlot',
      message: 'Select a time slot:',
      choices: sortedCandidates.slice(0, 20).map((candidate, index) => ({
        name: `${format(candidate.date, 'EEE, MMM d')} ${formatJST(candidate.start, 'HH:mm')}-${formatJST(candidate.end, 'HH:mm')} JST`,
        value: index
      })),
      pageSize: 10,
      loop: false
    }
  ]);
  
  const selected = sortedCandidates[selectedSlot];
  
  return {
    start: {
      dateTime: selected.start.toISOString(),
      timeZone: 'Asia/Tokyo'
    },
    end: {
      dateTime: selected.end.toISOString(),
      timeZone: 'Asia/Tokyo'
    }
  };
}

async function promptForManualTime(): Promise<{ start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } }> {
  const { date, startTime, duration } = await inquirer.prompt([
    {
      type: 'input',
      name: 'date',
      message: 'Date (YYYY-MM-DD):',
      default: format(new Date(), 'yyyy-MM-dd'),
      validate: (input: string) => {
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        return dateRegex.test(input) || 'Please enter a valid date (YYYY-MM-DD)';
      }
    },
    {
      type: 'input',
      name: 'startTime',
      message: 'Start time (HH:mm):',
      default: '10:00',
      validate: (input: string) => {
        const timeRegex = /^\d{2}:\d{2}$/;
        return timeRegex.test(input) || 'Please enter a valid time (HH:mm)';
      }
    },
    {
      type: 'number',
      name: 'duration',
      message: 'Duration (minutes):',
      default: 30
    }
  ]);
  
  const startDateTime = new Date(`${date}T${startTime}:00+09:00`);
  const endDateTime = addMinutes(startDateTime, duration);
  
  return {
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: 'Asia/Tokyo'
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: 'Asia/Tokyo'
    }
  };
}

async function promptForLocation(): Promise<{ displayName: string } | undefined> {
  const { hasLocation } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'hasLocation',
      message: 'Add location?',
      default: false
    }
  ]);
  
  if (hasLocation) {
    const { location } = await inquirer.prompt([
      {
        type: 'input',
        name: 'location',
        message: 'Location:'
      }
    ]);
    return { displayName: location };
  }
  
  return undefined;
}

function handleCreateEventError(error: any): void {
  if (error.message?.includes('ErrorAccessDenied')) {
    console.error(chalk.yellow('\n⚠️  Access denied to create calendar events'));
    console.error(chalk.gray('You may need additional permissions (Calendars.ReadWrite).'));
    console.error(chalk.gray('\nTry logging in with write permissions:'));
    console.error(chalk.cyan('npx outlook-agent login'));
  } else {
    console.error(chalk.red('Failed to create event:'), error.message || error);
  }
  process.exit(1);
}