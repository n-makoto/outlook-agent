import { EventConflict } from '../types/conflict.js';
import { CalendarEvent } from '../types/calendar.js';

interface IgnoreRule {
  description: string;
  conditions: {
    day_of_week?: string;
    time?: string;
    event1_pattern?: string;
    event2_pattern?: string;
  }[];
}

interface AIInstructions {
  custom_rules?: {
    ignore_conflicts?: IgnoreRule[];
  };
}

export class ConflictFilter {
  private readonly ignoreRules: IgnoreRule[];

  constructor(aiInstructions: AIInstructions) {
    this.ignoreRules = aiInstructions.custom_rules?.ignore_conflicts || [];
  }

  filterConflicts(conflicts: EventConflict[], verbose: boolean = false): EventConflict[] {
    if (this.ignoreRules.length === 0) {
      return conflicts;
    }

    return conflicts.filter(conflict => {
      for (const rule of this.ignoreRules) {
        if (this.shouldIgnoreConflict(conflict, rule)) {
          if (verbose) {
            console.log(`特別ルール適用: ${rule.description}`);
          }
          return false; // このコンフリクトを除外
        }
      }
      return true; // このコンフリクトを保持
    });
  }

  private shouldIgnoreConflict(conflict: EventConflict, rule: IgnoreRule): boolean {
    for (const condition of rule.conditions) {
      if (!this.checkCondition(conflict, condition)) {
        return false; // 条件に一致しない場合、このルールは適用されない
      }
    }
    return true; // すべての条件に一致した場合、このコンフリクトを無視
  }

  private checkCondition(conflict: EventConflict, condition: IgnoreRule['conditions'][0]): boolean {
    // 曜日のチェック
    if (condition.day_of_week) {
      const conflictDate = new Date(conflict.startTime);
      const dayMap: { [key: string]: number } = {
        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
        'Thursday': 4, 'Friday': 5, 'Saturday': 6
      };
      if (dayMap[condition.day_of_week] !== conflictDate.getDay()) {
        return false;
      }
    }

    // 時刻のチェック
    if (condition.time) {
      const conflictDate = new Date(conflict.startTime);
      const [hour] = condition.time.split(':').map(Number);
      if (conflictDate.getHours() !== hour) {
        return false;
      }
    }

    // イベントパターンのチェック
    if (condition.event1_pattern && condition.event2_pattern) {
      const hasEvent1 = conflict.events.some((e: CalendarEvent) => 
        e.subject.includes(condition.event1_pattern!)
      );
      const hasEvent2 = conflict.events.some((e: CalendarEvent) => 
        e.subject.includes(condition.event2_pattern!)
      );
      if (!hasEvent1 || !hasEvent2) {
        return false;
      }
    }

    return true;
  }
}