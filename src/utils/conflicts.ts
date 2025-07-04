import { CalendarEvent } from '../types/calendar.js';
import { EventConflict } from '../types/conflict.js';

export function detectConflicts(events: CalendarEvent[]): EventConflict[] {
  const conflicts: EventConflict[] = [];
  
  // Declinedイベントと終日イベント、Freeとして表示されるイベントを除外
  // tentativeな予定は含める
  const activeEvents = events.filter(event => 
    !event.subject.startsWith('Declined:') &&
    !event.isAllDay &&
    event.showAs !== 'free' &&
    event.responseStatus?.response !== 'declined'
  );

  // イベントを開始時刻でソート
  const sortedEvents = activeEvents.sort((a, b) => 
    new Date(a.start.dateTime).getTime() - new Date(b.start.dateTime).getTime()
  );

  // 重複をチェック
  for (let i = 0; i < sortedEvents.length; i++) {
    const conflictGroup: CalendarEvent[] = [sortedEvents[i]];
    const eventStart = new Date(sortedEvents[i].start.dateTime);
    const eventEnd = new Date(sortedEvents[i].end.dateTime);
    
    // このイベントと重複する他のイベントを探す
    for (let j = i + 1; j < sortedEvents.length; j++) {
      const compareStart = new Date(sortedEvents[j].start.dateTime);
      const compareEnd = new Date(sortedEvents[j].end.dateTime);
      
      // 時間の重複をチェック
      if (
        (compareStart >= eventStart && compareStart < eventEnd) ||
        (compareEnd > eventStart && compareEnd <= eventEnd) ||
        (compareStart <= eventStart && compareEnd >= eventEnd)
      ) {
        conflictGroup.push(sortedEvents[j]);
      }
    }
    
    // 2つ以上のイベントが重複している場合のみ記録
    if (conflictGroup.length > 1) {
      // 既に記録されているコンフリクトグループに含まれていないかチェック
      const isAlreadyRecorded = conflicts.some(conflict =>
        conflict.events.some(e => conflictGroup.some(ce => ce.id === e.id))
      );
      
      if (!isAlreadyRecorded) {
        // コンフリクトグループの時間範囲を計算
        const startTimes = conflictGroup.map(e => new Date(e.start.dateTime));
        const endTimes = conflictGroup.map(e => new Date(e.end.dateTime));
        
        conflicts.push({
          events: conflictGroup,
          startTime: new Date(Math.min(...startTimes.map(d => d.getTime()))),
          endTime: new Date(Math.max(...endTimes.map(d => d.getTime())))
        });
      }
    }
  }
  
  return conflicts;
}

export function formatConflictSummary(conflict: EventConflict): string {
  const events = conflict.events.map(e => ({
    subject: e.subject,
    organizer: e.organizer?.emailAddress.name || e.organizer?.emailAddress.address || 'Unknown',
    attendeeCount: e.attendees?.length || 0,
    responseStatus: e.responseStatus?.response || 'none'
  }));
  
  return events.map(e => 
    `• ${e.subject} (by ${e.organizer}, ${e.attendeeCount} attendees, status: ${e.responseStatus})`
  ).join('\n');
}