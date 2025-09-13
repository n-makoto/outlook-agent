// Mastraパッケージのインストール問題を回避するため一時的にコメントアウト
// import { createTool } from '@mastra/core/tools';

// スタブ実装
const createTool = (config: any) => config;
import { z } from 'zod';
import { MgcService } from '../../services/mgc.js';
import { detectConflicts } from '../../utils/conflicts.js';
import { calculateEventPriority, loadSchedulingRules } from '../../utils/rules.js';

// 設定の読み込み（簡易版）
const getConfig = () => ({
  timezone: process.env.OUTLOOK_AGENT_TIMEZONE || process.env.TZ || 'Asia/Tokyo',
  notificationPolicy: {
    reschedule: true,
    decline: true,
    accept: false
  }
});

export const getCalendarTools = () => {
  const config = getConfig();
  
  return {
    getWeeklySchedule: createTool({
      id: 'get-weekly-schedule',
      description: '指定期間のスケジュールを取得',
      inputSchema: z.object({
        days: z.number().default(7).describe('取得する日数'),
      }),
      execute: async ({ input }: { input: any }) => {
        const mgc = new MgcService();
        const events = await mgc.getUpcomingEvents(input.days);
        return {
          totalEvents: events.length,
          events: events.map(e => ({
            id: e.id,
            subject: e.subject,
            start: e.start,
            end: e.end,
            attendees: e.attendees?.length || 0,
            organizer: e.organizer?.emailAddress.address,
            isAllDay: e.isAllDay,
            responseStatus: e.responseStatus?.response
          }))
        };
      },
    }),

    detectScheduleConflicts: createTool({
      id: 'detect-conflicts',
      description: 'スケジュールのコンフリクトを検出',
      inputSchema: z.object({
        days: z.number().default(7).describe('チェックする日数'),
      }),
      execute: async ({ input }: { input: any }) => {
        const mgc = new MgcService();
        const events = await mgc.getUpcomingEvents(input.days);
        const conflicts = detectConflicts(events);
        
        return {
          totalConflicts: conflicts.length,
          conflicts: conflicts.map(c => ({
            startTime: c.startTime,
            endTime: c.endTime,
            events: c.events.map(e => ({
              id: e.id,
              subject: e.subject,
              attendees: e.attendees?.length || 0,
              organizer: e.organizer?.emailAddress.address,
              responseStatus: e.responseStatus?.response
            }))
          }))
        };
      },
    }),

    findAvailableSlots: createTool({
      id: 'find-available-slots',
      description: '指定した参加者全員が空いている時間を検索',
      inputSchema: z.object({
        attendees: z.array(z.string()).describe('参加者のメールアドレス'),
        duration: z.number().default(30).describe('会議時間（分）'),
        startDate: z.string().optional().describe('検索開始日時（ISO 8601）'),
        endDate: z.string().optional().describe('検索終了日時（ISO 8601）'),
      }),
      execute: async ({ input }: { input: any }) => {
        const mgc = new MgcService();
        
        const startDate = input.startDate || new Date().toISOString();
        const endDate = input.endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        
        const data = {
          attendees: input.attendees.map((email: any) => ({
            emailAddress: { address: email }
          })),
          timeConstraint: {
            timeslots: [{
              start: { 
                dateTime: startDate,
                timeZone: config.timezone
              },
              end: {
                dateTime: endDate,
                timeZone: config.timezone
              }
            }]
          },
          meetingDuration: `PT${input.duration}M`,
          maxCandidates: 10
        };
        
        const result = await mgc.findMeetingTimes(data);
        return {
          suggestions: result.meetingTimeSuggestions || [],
          emptySuggestionsReason: result.emptySuggestionsReason
        };
      },
    }),

    getFreeBusy: createTool({
      id: 'get-free-busy',
      description: '指定したユーザーの空き時間情報を取得',
      inputSchema: z.object({
        emails: z.array(z.string()).describe('チェックするユーザーのメールアドレス'),
        startTime: z.string().describe('開始日時（ISO 8601）'),
        endTime: z.string().describe('終了日時（ISO 8601）'),
      }),
      execute: async ({ input }: { input: any }) => {
        const mgc = new MgcService();
        const result = await mgc.getUserFreeBusy(
          input.emails,
          input.startTime,
          input.endTime
        );
        return result;
      },
    }),

    proposeReschedule: createTool({
      id: 'propose-reschedule',
      description: 'イベントのリスケジュール案を生成（実際の変更は行わない）',
      inputSchema: z.object({
        eventId: z.string().describe('リスケジュールするイベントID'),
        newStartTime: z.string().describe('新しい開始時刻（ISO 8601）'),
        newEndTime: z.string().describe('新しい終了時刻（ISO 8601）'),
        reason: z.string().describe('リスケジュールの理由'),
      }),
      execute: async ({ input }: { input: any }) => {
        // 提案のみを返す（実際の変更はユーザー承認後）
        return {
          proposal: {
            eventId: input.eventId,
            originalTime: 'To be fetched',
            newTime: {
              start: input.newStartTime,
              end: input.newEndTime
            },
            reason: input.reason,
            status: 'pending_approval'
          }
        };
      },
    }),

    analyzeEventPriorities: createTool({
      id: 'analyze-priorities',
      description: 'イベントの優先度を分析',
      inputSchema: z.object({
        events: z.array(z.object({
          id: z.string(),
          subject: z.string(),
          attendees: z.number(),
          organizer: z.string().optional(),
        })).describe('分析するイベントのリスト'),
      }),
      execute: async ({ input }: { input: any }) => {
        const rulesResult = await loadSchedulingRules();
        const priorities = input.events.map((event: any) => {
          const priority = calculateEventPriority(
            {
              subject: event.subject,
              attendees: new Array(event.attendees),
              organizer: { emailAddress: { address: event.organizer || '' } }
            },
            rulesResult.rules
          );
          return {
            eventId: event.id,
            subject: event.subject,
            ...priority
          };
        });
        
        return { priorities, rules: rulesResult.rules.rules };
      },
    }),
  };
};