import { CalendarEvent } from '../types/calendar.js';
import { EventConflict } from '../types/conflict.js';

/**
 * 2つのイベントが時間的に重複しているかチェック
 */
function eventsOverlap(event1: CalendarEvent, event2: CalendarEvent): boolean {
  const start1 = new Date(event1.start.dateTime);
  const end1 = new Date(event1.end.dateTime);
  const start2 = new Date(event2.start.dateTime);
  const end2 = new Date(event2.end.dateTime);
  
  return (
    (start2 >= start1 && start2 < end1) ||
    (end2 > start1 && end2 <= end1) ||
    (start2 <= start1 && end2 >= end1)
  );
}

/**
 * Union-Findを使用して連結成分を見つける
 */
class UnionFind {
  private parent: number[];
  private rank: number[];
  
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array(size).fill(0);
  }
  
  find(x: number): number {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }
  
  union(x: number, y: number): void {
    const rootX = this.find(x);
    const rootY = this.find(y);
    
    if (rootX !== rootY) {
      if (this.rank[rootX] < this.rank[rootY]) {
        this.parent[rootX] = rootY;
      } else if (this.rank[rootX] > this.rank[rootY]) {
        this.parent[rootY] = rootX;
      } else {
        this.parent[rootY] = rootX;
        this.rank[rootX]++;
      }
    }
  }
  
  getGroups(): number[][] {
    const groups: Map<number, number[]> = new Map();
    
    for (let i = 0; i < this.parent.length; i++) {
      const root = this.find(i);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root)!.push(i);
    }
    
    return Array.from(groups.values()).filter(group => group.length > 1);
  }
}

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

  if (sortedEvents.length < 2) {
    return conflicts;
  }

  // Union-Findを初期化
  const uf = new UnionFind(sortedEvents.length);
  
  // すべてのイベントペアをチェックして重複を検出
  for (let i = 0; i < sortedEvents.length; i++) {
    for (let j = i + 1; j < sortedEvents.length; j++) {
      if (eventsOverlap(sortedEvents[i], sortedEvents[j])) {
        uf.union(i, j);
      }
    }
  }
  
  // 連結成分（コンフリクトグループ）を取得
  const conflictGroups = uf.getGroups();
  
  // 各コンフリクトグループをEventConflictに変換
  for (const group of conflictGroups) {
    const conflictEvents = group.map(index => sortedEvents[index]);
    
    // コンフリクトグループの時間範囲を計算
    const startTimes = conflictEvents.map(e => new Date(e.start.dateTime));
    const endTimes = conflictEvents.map(e => new Date(e.end.dateTime));
    
    conflicts.push({
      events: conflictEvents,
      startTime: new Date(Math.min(...startTimes.map(d => d.getTime()))),
      endTime: new Date(Math.max(...endTimes.map(d => d.getTime())))
    });
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