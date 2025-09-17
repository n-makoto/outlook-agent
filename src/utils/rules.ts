import * as fs from 'fs/promises';
import * as path from 'path';
// @ts-ignore
import * as yaml from 'js-yaml';
import { z } from 'zod';

// ルールファイルのスキーマ定義
const PriorityRuleSchema = z.object({
  pattern: z.string().optional(),
  exclude_pattern: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  description: z.string().optional(),
  attendees_count: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    description: z.string().optional(),
  }).optional(),
  organizer_patterns: z.array(z.string()).optional(),
  response_required: z.boolean().optional(),
});

const SchedulingRulesSchema = z.object({
  version: z.number(),
  priorities: z.object({
    critical: z.array(PriorityRuleSchema).optional(),
    high: z.array(PriorityRuleSchema).optional(),
    medium: z.array(PriorityRuleSchema).optional(),
    low: z.array(PriorityRuleSchema).optional(),
  }),
  rules: z.object({
    priority_difference: z.array(z.object({
      if_diff_greater_than: z.number().optional(),
      if_diff_less_than: z.number().optional(),
      then: z.string(),
      description: z.string().optional(),
    })).optional(),
    time_preferences: z.array(z.object({
      avoid_times: z.array(z.string()).optional(),
      preferred_times: z.array(z.string()).optional(),
      description: z.string().optional(),
    })).optional(),
    buffer_time: z.object({
      default_minutes: z.number(),
      between_external_meetings: z.number().optional(),
      after_long_meetings: z.object({
        duration_threshold: z.number(),
        buffer_minutes: z.number(),
      }).optional(),
    }).optional(),
    special_rules: z.array(z.object({
      recurring_meetings: z.object({
        action: z.string(),
        description: z.string(),
      }).optional(),
      organizer_is_self: z.object({
        action: z.string(),
        description: z.string(),
      }).optional(),
      external_attendees: z.object({
        action: z.string(),
        description: z.string(),
      }).optional(),
    })).optional(),
  }).optional(),
  learning: z.object({
    enabled: z.boolean(),
    approval_threshold: z.number(),
    min_samples: z.number(),
  }).optional(),
  notifications: z.object({
    on_reschedule: z.boolean(),
    on_decline: z.boolean(),
    on_accept: z.boolean(),
  }).optional(),
  messages: z.object({
    reschedule: z.object({
      default: z.string(),
      with_suggestion: z.string(),
    }).optional(),
    decline: z.object({
      default: z.string(),
      with_alternative: z.string(),
    }).optional(),
  }).optional(),
});

export type SchedulingRules = z.infer<typeof SchedulingRulesSchema>;

/**
 * デフォルトのルールファイルパスを取得
 */
export function getDefaultRulesPath(): string {
  return path.join(process.cwd(), 'prompts', 'scheduling-rules.yaml');
}

/**
 * スケジューリングルールを読み込む
 */
export async function loadSchedulingRules(rulesPath?: string): Promise<{ rules: SchedulingRules; filePath: string; isDefault: boolean }> {
  const filePath = rulesPath || getDefaultRulesPath();
  const isCustom = !!rulesPath;
  
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const rawRules = yaml.load(fileContent);
    
    // バリデーション
    const rules = SchedulingRulesSchema.parse(rawRules);
    return {
      rules,
      filePath,
      isDefault: !isCustom
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      // ファイルが存在しない場合
      if (isCustom) {
        // カスタムファイルが存在しない場合はエラー
        throw new Error(`指定されたルールファイルが見つかりません: ${filePath}`);
      }
      // デフォルトファイルが存在しない場合は内蔵ルールを返す
      return {
        rules: getDefaultRules(),
        filePath: '(内蔵デフォルトルール)',
        isDefault: true
      };
    }
    throw error;
  }
}

/**
 * デフォルトのスケジューリングルール
 */
export function getDefaultRules(): SchedulingRules {
  return {
    version: 1.0,
    priorities: {
      critical: [],
      high: [],
      medium: [],
      low: [],
    },
    rules: {
      buffer_time: {
        default_minutes: 15,
      },
    },
  };
}

interface PriorityConfig {
  rules: any[];
  score: number;
  level: string;
  description: string;
}

function checkPriorityLevel(
  subject: string,
  attendeesCount: number,
  organizer: string,
  config: PriorityConfig
): { score: number; level: string; reason: string } | null {
  for (const rule of config.rules) {
    if (matchesRule(subject, attendeesCount, organizer, rule)) {
      return {
        score: config.score,
        level: config.level,
        reason: rule.description || config.description
      };
    }
  }
  return null;
}

/**
 * イベントの優先度を計算
 */
export function calculateEventPriority(
  event: any,
  rules: SchedulingRules
): { score: number; level: string; reasons: string[] } {
  const subject = event.subject || '';
  const attendeesCount = event.attendees?.length || 0;
  const organizer = event.organizer?.emailAddress?.address || '';
  
  const priorityLevels: PriorityConfig[] = [
    {
      rules: rules.priorities.critical || [],
      score: 100,
      level: 'critical',
      description: 'Critical priority match'
    },
    {
      rules: rules.priorities.high || [],
      score: 75,
      level: 'high',
      description: 'High priority match'
    },
    {
      rules: rules.priorities.medium || [],
      score: 50,
      level: 'medium',
      description: 'Medium priority match'
    },
    {
      rules: rules.priorities.low || [],
      score: 25,
      level: 'low',
      description: 'Low priority match'
    }
  ];
  
  for (const config of priorityLevels) {
    const result = checkPriorityLevel(subject, attendeesCount, organizer, config);
    if (result) {
      return {
        score: result.score,
        level: result.level,
        reasons: [result.reason]
      };
    }
  }
  
  return {
    score: 50,
    level: 'medium',
    reasons: ['Default priority']
  };
}

function checkPatternMatch(subject: string, rule: z.infer<typeof PriorityRuleSchema>): boolean {
  if (rule.pattern) {
    const regex = new RegExp(rule.pattern, 'i');
    if (!regex.test(subject)) {
      return false;
    }
  }
  
  if (rule.exclude_pattern) {
    const excludeRegex = new RegExp(rule.exclude_pattern, 'i');
    if (excludeRegex.test(subject)) {
      return false;
    }
  }
  
  return true;
}

function checkKeywordMatch(subject: string, rule: z.infer<typeof PriorityRuleSchema>): boolean {
  if (!rule.keywords || rule.keywords.length === 0) {
    return true;
  }
  
  const subjectLower = subject.toLowerCase();
  return rule.keywords.some(keyword => 
    subjectLower.includes(keyword.toLowerCase())
  );
}

function checkAttendeesCount(attendeesCount: number, rule: z.infer<typeof PriorityRuleSchema>): boolean {
  if (!rule.attendees_count) {
    return true;
  }
  
  if (rule.attendees_count.min !== undefined && attendeesCount < rule.attendees_count.min) {
    return false;
  }
  
  if (rule.attendees_count.max !== undefined && attendeesCount > rule.attendees_count.max) {
    return false;
  }
  
  return true;
}

function checkOrganizerPattern(organizer: string, rule: z.infer<typeof PriorityRuleSchema>): boolean {
  if (!rule.organizer_patterns || rule.organizer_patterns.length === 0) {
    return true;
  }
  
  return rule.organizer_patterns.some(pattern =>
    organizer.includes(pattern)
  );
}

/**
 * ルールがイベントにマッチするかチェック
 */
function matchesRule(
  subject: string,
  attendeesCount: number,
  organizer: string,
  rule: z.infer<typeof PriorityRuleSchema>
): boolean {
  return checkPatternMatch(subject, rule) &&
         checkKeywordMatch(subject, rule) &&
         checkAttendeesCount(attendeesCount, rule) &&
         checkOrganizerPattern(organizer, rule);
}

/**
 * コンフリクト解決アクションを決定
 */
export function determineConflictAction(
  priorityDiff: number,
  rules: SchedulingRules
): { action: string; description: string } {
  if (!rules.rules?.priority_difference) {
    return { action: 'manual_decision', description: 'No rules defined' };
  }
  
  for (const rule of rules.rules.priority_difference) {
    if (rule.if_diff_greater_than !== undefined && priorityDiff > rule.if_diff_greater_than) {
      return { action: rule.then, description: rule.description || '' };
    }
    if (rule.if_diff_less_than !== undefined && priorityDiff < rule.if_diff_less_than) {
      return { action: rule.then, description: rule.description || '' };
    }
  }
  
  return { action: 'manual_decision', description: 'No matching rule' };
}