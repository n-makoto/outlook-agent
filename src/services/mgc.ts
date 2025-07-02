import { exec } from 'child_process';
import { promisify } from 'util';
import { CalendarEvent } from '../types/calendar.js';

const execAsync = promisify(exec);

export class MgcService {
  async executeCommand(command: string): Promise<any> {
    try {
      // デバッグ用にコマンドを出力（一時的）
      if (process.env.DEBUG) {
        console.log('Executing:', command);
      }
      
      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 10 * 1024 * 1024 // 10MB
      });
      if (stderr) {
        console.error('MGC stderr:', stderr);
      }
      const result = JSON.parse(stdout);
      if (result.error) {
        throw new Error(`API Error: ${result.error.code} - ${result.error.message}`);
      }
      return result;
    } catch (error: any) {
      if (error.message?.includes('API Error:')) {
        throw error;
      }
      throw new Error(`MGC command failed: ${error.message || error}`);
    }
  }

  async getMyCalendarEvents(startDate: string, endDate: string, excludeDeclined: boolean = false): Promise<CalendarEvent[]> {
    const command = `mgc me calendar-view list \
      --headers 'Prefer=outlook.timezone="Asia/Tokyo"' \
      --select "id,subject,start,end,location,responseStatus,attendees,isAllDay,isCancelled,showAs" \
      --start-date-time "${startDate}" \
      --end-date-time "${endDate}" \
      --filter "isCancelled eq false" \
      --orderby "isAllDay,start/dateTime" \
      --top 250`;

    const result = await this.executeCommand(command);
    const events = result.value || [];
    
    if (excludeDeclined) {
      return events.filter((event: CalendarEvent) => 
        !event.responseStatus || event.responseStatus.response !== 'declined'
      );
    }
    
    return events;
  }

  async checkAuth(): Promise<boolean> {
    try {
      await execAsync('mgc me get --select id');
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentUser(): Promise<{ id: string; mail: string; displayName: string }> {
    const command = 'mgc me get --select "id,mail,displayName"';
    const result = await this.executeCommand(command);
    return result;
  }

  async getUserCalendarEvents(userEmail: string, startDate: string, endDate: string): Promise<CalendarEvent[]> {
    // まず共有カレンダーとして試す
    try {
      const sharedCommand = `mgc me calendars list --filter "owner/address eq '${userEmail}'"`;
      const calendarsResult = await this.executeCommand(sharedCommand);
      
      if (calendarsResult.value && calendarsResult.value.length > 0) {
        // 共有カレンダーが見つかった場合
        const calendarId = calendarsResult.value[0].id;
        const eventsCommand = `mgc me calendars ${calendarId} calendar-view list \
          --headers 'Prefer=outlook.timezone="Asia/Tokyo"' \
          --select "id,subject,start,end,location,responseStatus,attendees,isAllDay,isCancelled" \
          --start-date-time "${startDate}" \
          --end-date-time "${endDate}" \
          --filter "isCancelled eq false" \
          --orderby "isAllDay,start/dateTime" \
          --top 50`;
        
        const result = await this.executeCommand(eventsCommand);
        return result.value || [];
      }
    } catch (error) {
      // 共有カレンダーアクセスに失敗した場合は次の方法を試す
      if (process.env.DEBUG) {
        console.log('Shared calendar access failed, trying direct access...');
      }
    }

    // 直接アクセスを試す（組織内で権限がある場合）
    const command = `mgc users calendar-view list \
      --user-id "${userEmail}" \
      --headers 'Prefer=outlook.timezone="Asia/Tokyo"' \
      --select "id,subject,start,end,location,responseStatus,attendees,isAllDay,isCancelled" \
      --start-date-time "${startDate}" \
      --end-date-time "${endDate}" \
      --filter "isCancelled eq false" \
      --orderby "isAllDay,start/dateTime" \
      --top 50`;

    const result = await this.executeCommand(command);
    return result.value || [];
  }

  async getRecentEventsWithAttendees(): Promise<CalendarEvent[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30); // 過去30日間

    const formatDate = (date: Date) => {
      const offset = date.getTimezoneOffset();
      const offsetHours = Math.abs(Math.floor(offset / 60));
      const offsetMinutes = Math.abs(offset % 60);
      const offsetSign = offset <= 0 ? '+' : '-';
      const offsetString = `${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;
      
      return date.toISOString().slice(0, -5) + offsetString;
    };

    const command = `mgc me calendar-view list \
      --headers 'Prefer=outlook.timezone="Asia/Tokyo"' \
      --select "id,subject,start,end,attendees" \
      --start-date-time "${formatDate(startDate)}" \
      --end-date-time "${formatDate(endDate)}" \
      --filter "isCancelled eq false" \
      --top 100`;

    const result = await this.executeCommand(command);
    return result.value || [];
  }

  async getContactGroups(): Promise<any[]> {
    const command = 'mgc me contact-folders list --select "id,displayName"';
    const result = await this.executeCommand(command);
    return result.value || [];
  }

  async getContactGroupMembers(groupId: string): Promise<any[]> {
    const command = `mgc me contact-folders ${groupId} contacts list \
      --select "emailAddresses,displayName" \
      --top 100`;
    const result = await this.executeCommand(command);
    return result.value || [];
  }

  async createContactGroup(displayName: string): Promise<string> {
    const command = `mgc me contact-folders create --body '{"displayName": "${displayName}"}'`;
    const result = await this.executeCommand(command);
    return result.id;
  }

  async createEvent(eventData: {
    subject: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
    location?: { displayName: string };
    attendees?: Array<{ emailAddress: { address: string; name?: string } }>;
    body?: { contentType: string; content: string };
  }): Promise<string> {
    const body = JSON.stringify(eventData);
    const command = `mgc me events create --body '${body}'`;
    const result = await this.executeCommand(command);
    return result.id;
  }

  async findMeetingTimes(data: {
    attendees: Array<{ emailAddress: { address: string } }>;
    timeConstraint: {
      timeslots: Array<{
        start: { dateTime: string; timeZone: string };
        end: { dateTime: string; timeZone: string };
      }>;
    };
    meetingDuration: string; // ISO 8601 duration format (e.g., "PT30M")
    maxCandidates?: number;
  }): Promise<any> {
    const body = JSON.stringify(data);
    const command = `mgc me find-meeting-times post --body '${body}'`;
    return await this.executeCommand(command);
  }

  async getUserFreeBusy(emails: string[], startTime: string, endTime: string): Promise<any> {
    const data = {
      schedules: emails,
      startTime: { dateTime: startTime, timeZone: 'Asia/Tokyo' },
      endTime: { dateTime: endTime, timeZone: 'Asia/Tokyo' },
      availabilityViewInterval: 30
    };
    
    if (process.env.DEBUG) {
      console.log('Free/Busy request:', JSON.stringify(data, null, 2));
    }
    
    const body = JSON.stringify(data);
    const command = `mgc me calendar get-schedule post --body '${body}'`;
    const result = await this.executeCommand(command);
    
    if (process.env.DEBUG && result.value?.[0]) {
      const schedule = result.value[0];
      if (schedule.scheduleItems?.length > 0) {
        const firstItem = schedule.scheduleItems[0];
        console.log('First busy item sample:', JSON.stringify(firstItem, null, 2));
        console.log('Date comparison:');
        console.log('  Raw dateTime:', firstItem.start.dateTime);
        console.log('  Parsed as:', new Date(firstItem.start.dateTime).toString());
        console.log('  In JST:', new Date(firstItem.start.dateTime).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
      }
      
      // Also log availability view if present
      if (schedule.availabilityView) {
        console.log('\nAvailability view (first 48 chars):', schedule.availabilityView.substring(0, 48));
        console.log('Legend: 0=Free, 1=Tentative, 2=Busy, 3=OOF, 4=WorkingElsewhere');
        
        // 7/8の部分を特定して表示
        const requestStart = new Date(startTime);
        const targetDate = new Date('2025-07-08T00:00:00+09:00');
        const daysDiff = Math.floor((targetDate.getTime() - requestStart.getTime()) / (24 * 60 * 60 * 1000));
        
        if (daysDiff >= 0 && schedule.availabilityView.length > daysDiff * 48) {
          const dayStart = daysDiff * 48;
          const dayView = schedule.availabilityView.substring(dayStart, dayStart + 48);
          console.log(`\n7/8 availability (00:00-23:30): ${dayView}`);
          
          // 14:00-15:00を特定
          const slot14_00 = 28; // 14:00 = 28番目のスロット
          const slot15_00 = 30; // 15:00 = 30番目のスロット
          console.log(`7/8 14:00-15:00 (slots ${slot14_00}-${slot15_00}): "${dayView.substring(slot14_00, slot15_00)}"`);
        }
      }
    }
    
    return result;
  }

  async getEvent(eventId: string): Promise<CalendarEvent> {
    const command = `mgc me events get --event-id "${eventId}" \
      --select "id,subject,start,end,location,responseStatus,attendees,isAllDay,isCancelled,showAs,body"`;
    const result = await this.executeCommand(command);
    return result;
  }

  async updateEvent(eventId: string, eventData: Partial<{
    subject: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
    location?: { displayName: string };
    attendees?: Array<{ emailAddress: { address: string; name?: string } }>;
    body?: { contentType: string; content: string };
  }>): Promise<void> {
    const body = JSON.stringify(eventData);
    const command = `mgc me events patch --event-id "${eventId}" --body '${body}'`;
    await this.executeCommand(command);
  }

  async getUpcomingEvents(days: number = 7): Promise<CalendarEvent[]> {
    const now = new Date();
    const future = new Date();
    future.setDate(future.getDate() + days);
    
    const startDate = now.toISOString();
    const endDate = future.toISOString();
    
    const command = `mgc me calendar-view list \
      --headers 'Prefer=outlook.timezone="Asia/Tokyo"' \
      --select "id,subject,start,end,location,responseStatus,attendees,isAllDay,isCancelled,showAs" \
      --start-date-time "${startDate}" \
      --end-date-time "${endDate}" \
      --filter "isCancelled eq false" \
      --orderby "start/dateTime" \
      --top 100`;

    const result = await this.executeCommand(command);
    const events = result.value || [];
    
    // Declined予定を除外
    return events.filter((event: CalendarEvent) => 
      !event.responseStatus || event.responseStatus.response !== 'declined'
    );
  }
}