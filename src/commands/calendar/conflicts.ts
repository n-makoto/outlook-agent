import { MgcService } from '../../services/mgc.js';
import { detectConflicts, formatConflictSummary } from '../../utils/conflicts.js';
import { formatDateTimeRange } from '../../utils/format.js';
import { ConflictResolution } from '../../types/conflict.js';
import { CalendarEvent } from '../../types/calendar.js';
import chalk from 'chalk';
import inquirer from 'inquirer';

interface ConflictAction {
  action: 'resolve' | 'skip' | 'exit';
}

interface EventAction {
  eventAction: 'attend' | 'decline' | 'cancel' | 'reschedule' | 'keep';
}

async function processConflicts(
  conflicts: any[],
  mgc: MgcService
): Promise<void> {
  for (let i = 0; i < conflicts.length; i++) {
    const conflict = conflicts[i];
    const shouldContinue = await processConflict(conflict, i + 1, conflicts.length, mgc);
    
    if (!shouldContinue) {
      break;
    }
  }
}

async function processConflict(
  conflict: any,
  currentIndex: number,
  totalConflicts: number,
  mgc: MgcService
): Promise<boolean> {
  console.log(chalk.yellow(`\nConflict ${currentIndex}/${totalConflicts}:`));
  console.log(chalk.gray(`Time: ${formatDateTimeRange(conflict.startTime, conflict.endTime)}`));
  console.log(chalk.gray('Conflicting events:'));
  console.log(formatConflictSummary(conflict));
  
  const { action }: ConflictAction = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'How would you like to handle this conflict?',
      choices: [
        { name: 'Select which events to attend/decline', value: 'resolve' },
        { name: 'Skip this conflict', value: 'skip' },
        { name: 'Exit', value: 'exit' }
      ]
    }
  ]);
  
  if (action === 'exit') {
    return false;
  }
  
  if (action === 'skip') {
    return true;
  }
  
  const resolutions = await selectEventActions(conflict.events);
  
  if (resolutions.length > 0) {
    await confirmAndExecuteActions(resolutions, conflict.events, mgc);
  }
  
  return true;
}

async function selectEventActions(events: CalendarEvent[]): Promise<ConflictResolution[]> {
  const resolutions: ConflictResolution[] = [];
  
  for (const event of events) {
    displayEventInfo(event);
    
    const isOrganizer = event.responseStatus?.response === 'organizer';
    const choices = getEventActionChoices(isOrganizer);
    
    const { eventAction }: EventAction = await inquirer.prompt([
      {
        type: 'list',
        name: 'eventAction',
        message: 'What would you like to do with this event?',
        choices
      }
    ]);
    
    if (eventAction === 'keep') {
      continue;
    }
    
    const resolution = await createEventResolution(event.id, eventAction);
    if (resolution) {
      resolutions.push(resolution);
    }
  }
  
  return resolutions;
}

function displayEventInfo(event: CalendarEvent): void {
  console.log(chalk.cyan(`\nEvent: ${event.subject}`));
  console.log(chalk.white(`Organizer: ${event.organizer?.emailAddress.name || event.organizer?.emailAddress.address || 'Unknown'}`));
  console.log(chalk.white(`Current status: ${event.responseStatus?.response || 'none'}`));
  
  if (event.responseRequested === false) {
    console.log(chalk.white('Response required: No (RSVP not requested)'));
  }
  
  if (event.responseStatus?.response === 'organizer') {
    console.log(chalk.yellow('(You are the organizer)'));
  }
}

function getEventActionChoices(isOrganizer: boolean): Array<{ name: string; value: string }> {
  const choices = [
    { name: 'Attend this event', value: 'attend' },
    { name: 'Keep current status', value: 'keep' }
  ];
  
  if (!isOrganizer) {
    choices.splice(1, 0, 
      { name: 'Decline with message', value: 'decline' },
      { name: 'Reschedule this event', value: 'reschedule' }
    );
  } else {
    choices.splice(1, 0,
      { name: 'Cancel this event', value: 'cancel' },
      { name: 'Reschedule this event', value: 'reschedule' }
    );
  }
  
  return choices;
}

async function createEventResolution(
  eventId: string,
  eventAction: string
): Promise<ConflictResolution | null> {
  if (eventAction === 'decline') {
    const { declineMessage } = await inquirer.prompt([
      {
        type: 'input',
        name: 'declineMessage',
        message: 'Enter a message for declining (optional):',
        default: 'I have a scheduling conflict at this time.'
      }
    ]);
    
    return {
      eventId,
      action: 'decline',
      declineMessage
    };
  }
  
  if (eventAction === 'cancel') {
    const { cancelMessage } = await inquirer.prompt([
      {
        type: 'input',
        name: 'cancelMessage',
        message: 'Enter a message for cancelling (optional):',
        default: 'This meeting has been cancelled due to a scheduling conflict.'
      }
    ]);
    
    return {
      eventId,
      action: 'decline',
      declineMessage: cancelMessage
    };
  }
  
  return {
    eventId,
    action: eventAction as 'attend' | 'reschedule'
  };
}

async function confirmAndExecuteActions(
  resolutions: ConflictResolution[],
  events: CalendarEvent[],
  mgc: MgcService
): Promise<void> {
  displayPlannedActions(resolutions, events);
  
  const { confirmActions } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmActions',
      message: 'Execute these actions?',
      default: true
    }
  ]);
  
  if (confirmActions) {
    await executeActions(resolutions, events, mgc);
  }
}

function displayPlannedActions(
  resolutions: ConflictResolution[],
  events: CalendarEvent[]
): void {
  console.log(chalk.cyan('\nPlanned actions:'));
  
  for (const resolution of resolutions) {
    const event = events.find(e => e.id === resolution.eventId);
    const isOrganizer = event?.responseStatus?.response === 'organizer';
    
    if (resolution.action === 'decline') {
      if (isOrganizer) {
        console.log(chalk.red(`- Cancel: ${event?.subject}`));
      } else {
        console.log(chalk.red(`- Decline: ${event?.subject}`));
      }
      if (resolution.declineMessage) {
        console.log(chalk.gray(`  Message: ${resolution.declineMessage}`));
      }
    } else if (resolution.action === 'reschedule') {
      console.log(chalk.yellow(`- Reschedule: ${event?.subject}`));
    } else {
      console.log(chalk.green(`- Attend: ${event?.subject}`));
    }
  }
}

async function executeActions(
  resolutions: ConflictResolution[],
  events: CalendarEvent[],
  mgc: MgcService
): Promise<void> {
  for (const resolution of resolutions) {
    const event = events.find(e => e.id === resolution.eventId);
    await executeEventAction(resolution, event, mgc);
  }
}

async function executeEventAction(
  resolution: ConflictResolution,
  event: CalendarEvent | undefined,
  mgc: MgcService
): Promise<void> {
  const isOrganizer = event?.responseStatus?.response === 'organizer';
  
  if (resolution.action === 'attend') {
    await handleAttendAction(resolution.eventId, event, isOrganizer, mgc);
  } else if (resolution.action === 'decline') {
    await handleDeclineAction(resolution, event, isOrganizer, mgc);
  } else if (resolution.action === 'reschedule') {
    await handleRescheduleAction(resolution.eventId, event);
  }
}

async function handleAttendAction(
  eventId: string,
  event: CalendarEvent | undefined,
  isOrganizer: boolean,
  mgc: MgcService
): Promise<void> {
  if (!isOrganizer && event?.responseStatus?.response !== 'accepted') {
    console.log(chalk.cyan(`Accepting: ${event?.subject}...`));
    try {
      await mgc.updateEventResponse(eventId, 'accept');
      console.log(chalk.green('✓ Accepted'));
    } catch (error: any) {
      console.log(chalk.red('Failed to accept:'), error.message);
    }
  }
}

async function handleDeclineAction(
  resolution: ConflictResolution,
  event: CalendarEvent | undefined,
  isOrganizer: boolean,
  mgc: MgcService
): Promise<void> {
  if (isOrganizer) {
    await handleOrganizerCancellation(resolution, event, mgc);
  } else {
    await handleParticipantDecline(resolution, event, mgc);
  }
}

async function handleOrganizerCancellation(
  resolution: ConflictResolution,
  event: CalendarEvent | undefined,
  mgc: MgcService
): Promise<void> {
  console.log(chalk.cyan(`Cancelling: ${event?.subject}...`));
  try {
    await mgc.cancelEvent(resolution.eventId, resolution.declineMessage);
    console.log(chalk.green('✓ Event cancelled'));
  } catch (error: any) {
    console.log(chalk.red('Failed to cancel event:'), error.message);
  }
}

async function handleParticipantDecline(
  resolution: ConflictResolution,
  event: CalendarEvent | undefined,
  mgc: MgcService
): Promise<void> {
  console.log(chalk.cyan(`Processing: ${event?.subject}...`));
  
  if (event?.responseRequested === false) {
    await updateStatusWithoutNotification(resolution.eventId, mgc);
  } else {
    await declineWithNotification(resolution, mgc);
  }
}

async function updateStatusWithoutNotification(
  eventId: string,
  mgc: MgcService
): Promise<void> {
  console.log(chalk.yellow('This event does not require a response.'));
  console.log(chalk.gray('Updating your status to "declined" without sending notification...'));
  
  try {
    await mgc.updateEventResponse(eventId, 'decline');
    console.log(chalk.green('✓ Your status updated to "declined"'));
  } catch (error: any) {
    console.log(chalk.red('Failed to update status:'), error.message);
  }
}

async function declineWithNotification(
  resolution: ConflictResolution,
  mgc: MgcService
): Promise<void> {
  try {
    await mgc.declineEvent(resolution.eventId, resolution.declineMessage);
    console.log(chalk.green('✓ Declined and notification sent'));
  } catch (error: any) {
    if (error.message?.includes('hasn\'t requested a response')) {
      console.log(chalk.yellow('Cannot send decline notification - response not requested by organizer'));
      await updateStatusWithoutNotification(resolution.eventId, mgc);
    } else {
      throw error;
    }
  }
}

async function handleRescheduleAction(
  eventId: string,
  event: CalendarEvent | undefined
): Promise<void> {
  console.log(chalk.cyan(`\nRescheduling: ${event?.subject}`));
  const { rescheduleEvent } = await import('./reschedule.js');
  await rescheduleEvent(eventId);
}

export async function manageConflicts(days: number = 7): Promise<void> {
  const mgc = new MgcService();

  try {
    console.log(chalk.cyan(`Checking for scheduling conflicts in the next ${days} days...`));
    
    const events = await mgc.getUpcomingEvents(days);
    const conflicts = detectConflicts(events);
    
    if (conflicts.length === 0) {
      console.log(chalk.green('✓ No scheduling conflicts found!'));
      return;
    }
    
    console.log(chalk.yellow(`\nFound ${conflicts.length} conflict(s):\n`));
    
    await processConflicts(conflicts, mgc);
    
    console.log(chalk.green('\n✓ Conflict management completed!'));
  } catch (error: any) {
    console.error(chalk.red('Failed to manage conflicts:'), error.message || error);
    process.exit(1);
  }
}