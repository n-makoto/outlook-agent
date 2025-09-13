import * as fs from 'fs/promises';
import * as path from 'path';
// @ts-ignore
import * as yaml from 'js-yaml';
import { z } from 'zod';

// AI指示設定のスキーマ
const AIInstructionsSchema = z.object({
  version: z.number(),
  role: z.object({
    name: z.string(),
    description: z.string(),
  }),
  conflict_analysis: z.object({
    instructions: z.string(),
  }),
  suggestion_rules: z.object({
    prioritize_reschedule: z.boolean(),
    minimize_impact: z.boolean(),
    format: z.string(),
  }),
  communication_style: z.object({
    language: z.string(),
    tone: z.string(),
    use_emoji: z.boolean(),
    templates: z.object({
      high_confidence: z.string(),
      medium_confidence: z.string(),
      low_confidence: z.string(),
    }),
  }),
  reschedule_considerations: z.array(z.string()),
  feedback_collection: z.object({
    enabled: z.boolean(),
    questions: z.array(z.string()),
    save_feedback: z.boolean(),
    feedback_path: z.string(),
  }).optional(),
  custom_rules: z.object({
    never_reschedule: z.array(z.object({
      pattern: z.string(),
    })).optional(),
    avoid_scheduling: z.array(z.object({
      time_range: z.string(),
      reason: z.string(),
    })).optional(),
    vip_attendees: z.array(z.object({
      email_domain: z.string().optional(),
      email: z.string().optional(),
      priority_boost: z.number(),
    })).optional(),
    ignore_conflicts: z.array(z.object({
      description: z.string(),
      conditions: z.array(z.object({
        day_of_week: z.string().optional(),
        time: z.string().optional(),
        event1_pattern: z.string().optional(),
        event2_pattern: z.string().optional(),
      })),
      reason: z.string(),
    })).optional(),
  }).optional(),
  output_settings: z.object({
    show_priority_scores: z.boolean(),
    show_reasoning: z.boolean(),
    show_alternatives: z.boolean(),
    max_alternatives: z.number(),
    log_level: z.string(),
  }),
  error_handling: z.object({
    on_api_error: z.string(),
    on_timeout: z.string(),
    max_retries: z.number(),
  }),
});

export type AIInstructions = z.infer<typeof AIInstructionsSchema>;

/**
 * デフォルトのAI指示ファイルパスを取得
 */
export function getDefaultAIInstructionsPath(): string {
  return path.join(process.cwd(), 'prompts', 'ai-instructions.yaml');
}

/**
 * AI指示設定を読み込む
 */
export async function loadAIInstructions(instructionsPath?: string): Promise<{ instructions: AIInstructions; filePath: string; isDefault: boolean }> {
  const filePath = instructionsPath || getDefaultAIInstructionsPath();
  const isCustom = !!instructionsPath;
  
  try {
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const rawInstructions = yaml.load(fileContent);
    
    // バリデーション
    const instructions = AIInstructionsSchema.parse(rawInstructions);
    return {
      instructions,
      filePath,
      isDefault: !isCustom
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      // ファイルが存在しない場合
      if (isCustom) {
        // カスタムファイルが存在しない場合はエラー
        throw new Error(`指定されたAI指示ファイルが見つかりません: ${filePath}`);
      }
      // デフォルトファイルが存在しない場合は内蔵デフォルトを返す
      return {
        instructions: getDefaultAIInstructions(),
        filePath: '(内蔵デフォルトAI指示)',
        isDefault: true
      };
    }
    throw error;
  }
}

/**
 * デフォルトのAI指示設定
 */
export function getDefaultAIInstructions(): AIInstructions {
  return {
    version: 1.0,
    role: {
      name: 'スケジュール調整アシスタント',
      description: 'カレンダーのコンフリクトを解決する専門家です。',
    },
    conflict_analysis: {
      instructions: '優先度、影響度、代替案を総合的に分析してください。',
    },
    suggestion_rules: {
      prioritize_reschedule: true,
      minimize_impact: true,
      format: '構造化された提案を生成してください。',
    },
    communication_style: {
      language: '日本語',
      tone: '丁寧',
      use_emoji: false,
      templates: {
        high_confidence: '推奨: {suggestion}',
        medium_confidence: '提案: {suggestion}',
        low_confidence: '選択肢: {options}',
      },
    },
    reschedule_considerations: [
      '同じ日の別時間帯を優先',
      '参加者への影響を最小化',
    ],
    output_settings: {
      show_priority_scores: true,
      show_reasoning: true,
      show_alternatives: true,
      max_alternatives: 3,
      log_level: 'info',
    },
    error_handling: {
      on_api_error: 'fallback_to_rules',
      on_timeout: 'show_partial_results',
      max_retries: 3,
    },
  };
}

/**
 * AI用のシステムプロンプトを生成
 */
export function generateSystemPrompt(
  instructions: AIInstructions,
  schedulingRules: any,
  timezone: string
): string {
  const customRules = instructions.custom_rules || {};
  
  // ignore_conflictsルールを特別に処理
  let ignoreConflictsSection = '';
  if (customRules.ignore_conflicts && customRules.ignore_conflicts.length > 0) {
    ignoreConflictsSection = `
## 重要: コンフリクトとして扱わない特別ルール
以下の条件に該当するイベントの組み合わせは、コンフリクトとして扱わず、両方維持してください：
${customRules.ignore_conflicts.map((rule: any) => `
- ${rule.description}
  条件: ${JSON.stringify(rule.conditions, null, 2)}
  理由: ${rule.reason}
`).join('\n')}
`;
  }
  
  return `
# ${instructions.role.name}

${instructions.role.description}

## 基本設定
- 言語: ${instructions.communication_style.language}
- トーン: ${instructions.communication_style.tone}
- 絵文字使用: ${instructions.communication_style.use_emoji ? 'あり' : 'なし'}
- タイムゾーン: ${timezone}

${ignoreConflictsSection}

## コンフリクト分析の指示
${instructions.conflict_analysis.instructions}

## スケジューリングルール
${JSON.stringify(schedulingRules, null, 2)}

## カスタムルール
${JSON.stringify(customRules, null, 2)}

## リスケジュール時の考慮事項
${instructions.reschedule_considerations.map(c => `- ${c}`).join('\n')}

## 提案ルール
- リスケジュール優先: ${instructions.suggestion_rules.prioritize_reschedule}
- 影響最小化: ${instructions.suggestion_rules.minimize_impact}

## 出力設定
- 優先度スコア表示: ${instructions.output_settings.show_priority_scores}
- 理由の表示: ${instructions.output_settings.show_reasoning}
- 代替案表示: ${instructions.output_settings.show_alternatives}
- 最大代替案数: ${instructions.output_settings.max_alternatives}

## 出力フォーマット
${instructions.suggestion_rules.format}
`;
}

/**
 * コンフリクト分析用のユーザープロンプトを生成
 */
export function generateConflictAnalysisPrompt(
  conflict: any,
  instructions: AIInstructions
): string {
  const events = conflict.events.map((e: any) => 
    `- ${e.subject} (参加者: ${e.attendeesCount}名, 主催者: ${e.organizer || 'なし'})`
  ).join('\n');
  
  // 特別ルールのチェック
  let specialRuleNote = '';
  const customRules = instructions.custom_rules || {};
  if (customRules.ignore_conflicts) {
    for (const rule of customRules.ignore_conflicts) {
      // 簡易的なパターンマッチング（実際の日時や曜日の判定は改善の余地あり）
      const hasMatch = rule.conditions.some((cond: any) => {
        const event1Match = conflict.events.some((e: any) => 
          cond.event1_pattern && e.subject.includes(cond.event1_pattern)
        );
        const event2Match = conflict.events.some((e: any) => 
          cond.event2_pattern && e.subject.includes(cond.event2_pattern)
        );
        return event1Match && event2Match;
      });
      
      if (hasMatch) {
        specialRuleNote = `
## 特別ルール適用
${rule.description}
理由: ${rule.reason}
推奨: このコンフリクトは問題ないため、両方のイベントを維持してください。
`;
      }
    }
  }
  
  return `
以下のスケジュールコンフリクトを分析してください：

## コンフリクト情報
時間: ${conflict.timeRange}

## 対象イベント
${events}

## 各イベントの優先度
${JSON.stringify(conflict.events.map((e: any) => ({
  subject: e.subject,
  priority: e.priority
})), null, 2)}

${specialRuleNote}

## 分析依頼
1. 各イベントの重要度を評価
2. 最適な調整方法を提案
3. 代替案があれば提示
4. 判断理由を明確に説明

${instructions.output_settings.show_alternatives ? 
  `最大${instructions.output_settings.max_alternatives}個の代替案を提示してください。` : ''}
`;
}

/**
 * レスポンステンプレートを適用
 */
export function applyResponseTemplate(
  confidence: 'high' | 'medium' | 'low',
  content: string,
  instructions: AIInstructions
): string {
  const template = instructions.communication_style.templates[`${confidence}_confidence`];
  
  if (confidence === 'low') {
    return template.replace('{options}', content);
  } else {
    return template.replace('{suggestion}', content);
  }
}