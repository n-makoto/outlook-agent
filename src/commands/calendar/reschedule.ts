import { MgcService } from '../../services/mgc.js';
import { format, addDays, addMinutes, differenceInMinutes } from 'date-fns';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { CalendarEvent } from '../../types/calendar.js';
import { isWorkday } from '../../utils/holidays.js';

interface TimeSlotCandidate {
  date: Date;
  start: Date;
  end: Date;
}

interface RescheduleAction {
  action: 'reschedule' | 'decline' | 'cancel' | 'exit';
}

async function selectEventToReschedule(
  mgc: MgcService,
  eventId?: string
): Promise<CalendarEvent> {
  if (eventId) {
    return await mgc.getEvent(eventId);
  }
  
  console.log(chalk.cyan('Fetching your meetings...'));
  const upcomingEvents = await mgc.getUpcomingEvents(7);
  
  const eventsWithAttendees = upcomingEvents.filter(event => 
    event.attendees && event.attendees.length > 0 && 
    !event.subject.startsWith('Declined:')
  );
  
  if (eventsWithAttendees.length === 0) {
    throw new Error('No meetings with attendees found in the next 7 days');
  }
  
  const { selectedEventId } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedEventId',
      message: 'Select an event to reschedule:',
      choices: eventsWithAttendees.map(event => {
        const startDate = new Date(event.start.dateTime);
        const attendeeCount = event.attendees?.length || 0;
        const duration = differenceInMinutes(
          new Date(event.end.dateTime),
          startDate
        );
        return {
          name: `${format(startDate, 'EEE, MMM d HH:mm')} (${duration}min) - ${event.subject} [${attendeeCount} attendees]`,
          value: event.id
        };
      }),
      pageSize: 10,
      loop: false
    }
  ]);
  
  return eventsWithAttendees.find(e => e.id === selectedEventId)!;
}

function displayEventDetails(event: CalendarEvent): void {
  console.log(chalk.cyan('\nEvent details:'));
  console.log(chalk.white(`Subject: ${event.subject}`));
  console.log(chalk.white(`Organizer: ${event.organizer?.emailAddress.name || event.organizer?.emailAddress.address || 'Unknown'}`));
  console.log(chalk.white(`Current time: ${format(new Date(event.start.dateTime), 'EEE, MMM d HH:mm')} - ${format(new Date(event.end.dateTime), 'HH:mm')}`));
  console.log(chalk.white(`Attendees: ${event.attendees?.map(a => a.emailAddress.address).join(', ')}`));
}

async function selectRescheduleAction(
  isOrganizer: boolean
): Promise<string> {
  const choices = [
    { name: 'Find a new time', value: 'reschedule' },
    { name: 'Exit without changes', value: 'exit' }
  ];
  
  if (isOrganizer) {
    choices.splice(1, 0, { name: 'Cancel this meeting', value: 'cancel' });
    console.log(chalk.yellow('\n(You are the organizer)'));
  } else {
    choices.splice(1, 0, { name: 'Decline this meeting', value: 'decline' });
  }
  
  const { action }: RescheduleAction = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do with this meeting?',
      choices
    }
  ]);
  
  return action;
}

async function handleDeclineAction(
  mgc: MgcService,
  eventId: string
): Promise<void> {
  const { declineMessage } = await inquirer.prompt([
    {
      type: 'input',
      name: 'declineMessage',
      message: 'Enter a message for declining (optional):',
      default: 'I have a scheduling conflict at this time.'
    }
  ]);
  
  const { confirmDecline } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmDecline',
      message: 'Are you sure you want to decline this meeting?',
      default: true
    }
  ]);
  
  if (confirmDecline) {
    console.log(chalk.cyan('Declining meeting...'));
    await mgc.declineEvent(eventId, declineMessage);
    console.log(chalk.green('✓ Meeting declined successfully!'));
  } else {
    console.log(chalk.yellow('Decline aborted'));
  }
}

async function handleCancelAction(
  mgc: MgcService,
  eventId: string
): Promise<void> {
  const { cancelMessage } = await inquirer.prompt([
    {
      type: 'input',
      name: 'cancelMessage',
      message: 'Enter a cancellation message (optional):',
      default: 'This meeting has been cancelled.'
    }
  ]);
  
  const { confirmCancel } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmCancel',
      message: 'Are you sure you want to cancel this meeting?',
      default: false
    }
  ]);
  
  if (confirmCancel) {
    console.log(chalk.cyan('Cancelling meeting...'));
    await mgc.cancelEvent(eventId, cancelMessage);
    console.log(chalk.green('✓ Meeting cancelled successfully!'));
  } else {
    console.log(chalk.yellow('Cancellation aborted'));
  }
}

async function findAvailableTimeSlots(
  mgc: MgcService,
  selectedEvent: CalendarEvent,
  duration: number
): Promise<TimeSlotCandidate[]> {
  console.log(chalk.cyan('Finding available time slots...'));
  
  const now = new Date();
  const alignedNow = new Date(now);
  alignedNow.setMinutes(Math.floor(alignedNow.getMinutes() / 30) * 30, 0, 0);
  
  const searchDays = 14;
  const endSearchDate = addDays(alignedNow, searchDays);
  
  const attendeeEmails = selectedEvent.attendees?.map(a => a.emailAddress.address) || [];
  const currentUser = await mgc.getCurrentUser();
  if (!attendeeEmails.includes(currentUser.mail)) {
    attendeeEmails.push(currentUser.mail);
  }
  
  console.log(chalk.gray('Checking availability...'));
  
  const startDateStr = format(now, 'yyyy-MM-dd');
  const endDateStr = format(endSearchDate, 'yyyy-MM-dd');
  
  const [myEvents, freeBusyResult] = await Promise.all([
    mgc.getMyCalendarEvents(
      `${startDateStr}T00:00:00+09:00`,
      `${endDateStr}T23:59:59+09:00`
    ).catch(() => {
      console.warn(chalk.yellow('Could not fetch your calendar events'));
      return [] as CalendarEvent[];
    }),
    mgc.getUserFreeBusy(
      attendeeEmails,
      alignedNow.toISOString(),
      endSearchDate.toISOString()
    )
  ]);
  
  return findDaySlots(now, searchDays, duration, selectedEvent, myEvents, freeBusyResult);
}

function findDaySlots(
  now: Date,
  searchDays: number,
  duration: number,
  selectedEvent: CalendarEvent,
  myEvents: CalendarEvent[],
  freeBusyResult: any
): TimeSlotCandidate[] {
  const candidates: TimeSlotCandidate[] = [];
  
  for (let i = 0; i < searchDays; i++) {
    const date = addDays(now, i);
    
    if (!isWorkday(date)) {
      continue;
    }
    
    const daySlots = findSlotsForDay(date, now, duration, selectedEvent, myEvents, freeBusyResult, i);
    candidates.push(...daySlots);
  }
  
  return candidates;
}

function findSlotsForDay(
  date: Date,
  now: Date,
  duration: number,
  selectedEvent: CalendarEvent,
  myEvents: CalendarEvent[],
  freeBusyResult: any,
  dayIndex: number
): TimeSlotCandidate[] {
  const dateStr = format(date, 'yyyy-MM-dd');
  const candidates: TimeSlotCandidate[] = [];
  
  let searchStartTime = new Date(`${dateStr}T09:00:00+09:00`);
  const searchEndTime = new Date(`${dateStr}T19:00:00+09:00`);
  
  if (dayIndex === 0) {
    const minStartTime = addMinutes(now, 30);
    if (minStartTime > searchStartTime) {
      searchStartTime = minStartTime;
    }
  }
  
  let currentTime = searchStartTime;
  while (currentTime < searchEndTime && addMinutes(currentTime, duration) <= searchEndTime) {
    const slotEnd = addMinutes(currentTime, duration);
    
    const originalStart = new Date(selectedEvent.start.dateTime);
    if (currentTime.getTime() === originalStart.getTime()) {
      currentTime = addMinutes(currentTime, 30);
      continue;
    }
    
    if (isSlotAvailable(currentTime, slotEnd, selectedEvent, myEvents, freeBusyResult)) {
      candidates.push({
        date: date,
        start: currentTime,
        end: slotEnd
      });
    }
    
    currentTime = addMinutes(currentTime, 30);
  }
  
  return candidates;
}

function isSlotAvailable(
  currentTime: Date,
  slotEnd: Date,
  selectedEvent: CalendarEvent,
  myEvents: CalendarEvent[],
  freeBusyResult: any
): boolean {
  return isMyCalendarAvailable(currentTime, slotEnd, selectedEvent, myEvents) &&
         areAttendeesAvailable(currentTime, slotEnd, freeBusyResult);
}

function isMyCalendarAvailable(
  currentTime: Date,
  slotEnd: Date,
  selectedEvent: CalendarEvent,
  myEvents: CalendarEvent[]
): boolean {
  for (const event of myEvents) {
    if (event.id === selectedEvent.id) {continue;}
    
    const startDateTime = event.start.timeZone === 'Asia/Tokyo' 
      ? event.start.dateTime + '+09:00'
      : event.start.dateTime + 'Z';
    const endDateTime = event.end.timeZone === 'Asia/Tokyo'
      ? event.end.dateTime + '+09:00'
      : event.end.dateTime + 'Z';
      
    const eventStart = new Date(startDateTime);
    const eventEnd = new Date(endDateTime);
    
    if (eventStart.toDateString() !== currentTime.toDateString() &&
        eventEnd.toDateString() !== currentTime.toDateString()) {
      continue;
    }
    
    if (event.isAllDay && eventStart.toDateString() === currentTime.toDateString()) {
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

function areAttendeesAvailable(
  currentTime: Date,
  slotEnd: Date,
  freeBusyResult: any
): boolean {
  const schedules = freeBusyResult.value || [];
  
  for (const schedule of schedules) {
    const busyTimes = schedule.scheduleItems || [];
    
    for (const busy of busyTimes) {
      const busyStart = new Date(busy.start.dateTime + 'Z');
      const busyEnd = new Date(busy.end.dateTime + 'Z');
      
      if (busy.status === 'free') {
        continue;
      }
      
      if (hasTimeConflict(currentTime, slotEnd, busyStart, busyEnd)) {
        return false;
      }
    }
  }
  
  return true;
}

async function selectNewTimeSlot(
  candidates: TimeSlotCandidate[]
): Promise<TimeSlotCandidate | null> {
  if (candidates.length === 0) {
    console.log(chalk.yellow('No available time slots found in the next 14 days (weekdays only)'));
    return null;
  }
  
  const sortedCandidates = candidates.sort((a, b) => a.start.getTime() - b.start.getTime());
  const slotChoices = [
    ...sortedCandidates.slice(0, 20).map((candidate, index) => ({
      name: `${format(candidate.date, 'EEE, MMM d')} ${format(candidate.start, 'HH:mm')}-${format(candidate.end, 'HH:mm')}`,
      value: index
    })),
    { name: '── Cancel (go back) ──', value: -1 }
  ];
  
  const { selectedSlot } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedSlot',
      message: 'Select a new time slot:',
      choices: slotChoices,
      pageSize: 10,
      loop: false
    }
  ]);
  
  if (selectedSlot === -1) {
    return null;
  }
  
  return sortedCandidates[selectedSlot];
}

async function confirmAndUpdateEvent(
  mgc: MgcService,
  selectedEvent: CalendarEvent,
  newTimeSlot: TimeSlotCandidate
): Promise<void> {
  console.log(chalk.cyan('\nReschedule summary:'));
  console.log(chalk.gray(`From: ${format(new Date(selectedEvent.start.dateTime), 'EEE, MMM d HH:mm')} - ${format(new Date(selectedEvent.end.dateTime), 'HH:mm')}`));
  console.log(chalk.gray(`To: ${format(newTimeSlot.start, 'EEE, MMM d HH:mm')} - ${format(newTimeSlot.end, 'HH:mm')}`));
  
  const { confirmUpdate } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmUpdate',
      message: 'Confirm rescheduling?',
      default: true
    }
  ]);
  
  if (!confirmUpdate) {
    throw new Error('Reschedule cancelled');
  }
  
  console.log(chalk.cyan('Updating event...'));
  await mgc.updateEvent(selectedEvent.id, {
    start: {
      dateTime: newTimeSlot.start.toISOString(),
      timeZone: 'Asia/Tokyo'
    },
    end: {
      dateTime: newTimeSlot.end.toISOString(),
      timeZone: 'Asia/Tokyo'
    }
  });
  
  console.log(chalk.green('✓ Event rescheduled successfully!'));
  console.log(chalk.gray('Meeting invitations will be sent to all attendees.'));
}

export async function rescheduleEvent(eventId?: string): Promise<void> {
  const mgc = new MgcService();

  try {
    const selectedEvent = await selectEventToReschedule(mgc, eventId);
    
    displayEventDetails(selectedEvent);
    
    const currentUserInfo = await mgc.getCurrentUser();
    const isOrganizer = selectedEvent.organizer?.emailAddress.address === currentUserInfo.mail ||
                       selectedEvent.responseStatus?.response === 'organizer';
    
    const action = await selectRescheduleAction(isOrganizer);
    
    if (action === 'exit') {
      console.log(chalk.yellow('No changes made'));
      return;
    }
    
    if (action === 'decline') {
      await handleDeclineAction(mgc, selectedEvent.id);
      return;
    }
    
    if (action === 'cancel') {
      await handleCancelAction(mgc, selectedEvent.id);
      return;
    }
    
    const duration = differenceInMinutes(
      new Date(selectedEvent.end.dateTime),
      new Date(selectedEvent.start.dateTime)
    );
    
    const candidates = await findAvailableTimeSlots(mgc, selectedEvent, duration);
    const newTimeSlot = await selectNewTimeSlot(candidates);
    
    if (!newTimeSlot) {
      console.log(chalk.yellow('Reschedule cancelled'));
      return;
    }
    
    await confirmAndUpdateEvent(mgc, selectedEvent, newTimeSlot);
  } catch (error: any) {
    if (error.message === 'Reschedule cancelled' || error.message.includes('No meetings with attendees found')) {
      console.log(chalk.yellow(error.message));
      return;
    }
    console.error(chalk.red('Failed to reschedule event:'), error.message || error);
    process.exit(1);
  }
}