import { MgcService } from '../../services/mgc.js';
import { detectConflicts } from '../../utils/conflicts.js';
import { EventConflict } from '../../types/conflict.js';
import { CalendarEvent } from '../../types/calendar.js';
import { formatDateTimeRange } from '../../utils/format.js';
import { createSchedulerAgent } from '../../agents/scheduler/index.js';
import { calculateEventPriority, loadSchedulingRules, determineConflictAction } from '../../utils/rules.js';
import { loadAIInstructions, generateConflictAnalysisPrompt, generateSystemPrompt } from '../../utils/ai-prompt.js';
import { DecisionMemory } from '../../agents/scheduler/memory.js';
import { AIService } from '../../services/ai.js';
import { ConflictFilter } from '../../utils/conflict-filter.js';
import chalk from 'chalk';
import inquirer from 'inquirer';

interface ScheduleWeekOptions {
  dryRun?: boolean;
  date?: string;
  json?: boolean;
  rules?: string;
  instructions?: string;  // AI指示設定ファイルのパス
}

interface Configuration {
  timezone: string;
  model: string;
  startDate: Date;
  days: number;
  aiInstructions: any;
  aiInstructionsResult: any;
  rules: any;
  rulesResult: any;
}

interface ProposalSuggestion {
  action: string;
  reason?: string;
  description?: string;
  confidence?: string;
  aiAnalysis?: boolean | null;
  alternatives?: string[];
  aiError?: any;
  targetEventId?: string;
  specificTime?: string;
}

interface EventPriority {
  level: string;
  score: number;
  reasons: string[];
  aiScore?: number;
  aiReason?: string;
}

interface ProposalEvent {
  id: string;
  subject: string;
  organizer?: string;
  attendeesCount: number;
  responseStatus: string;
  priority?: EventPriority;
}

interface Proposal {
  conflictId: string;
  timeRange: string;
  events: ProposalEvent[];
  suggestion: ProposalSuggestion;
}

/**
 * 設定を初期化
 */
async function initializeConfiguration(options: ScheduleWeekOptions): Promise<Configuration> {
  const timezone = process.env.OUTLOOK_AGENT_TIMEZONE || process.env.TZ || 'Asia/Tokyo';
  const model = process.env.OUTLOOK_AGENT_MODEL || 'gpt-4o-mini';
  const startDate = options.date ? new Date(options.date) : new Date();
  const days = 7;
  
  const aiInstructionsResult = await loadAIInstructions(options.instructions);
  const rulesResult = await loadSchedulingRules(options.rules);
  
  return {
    timezone,
    model,
    startDate,
    days,
    aiInstructions: aiInstructionsResult.instructions,
    aiInstructionsResult,
    rules: rulesResult.rules,
    rulesResult
  };
}

/**
 * イベントを取得
 */
async function fetchEvents(mgc: MgcService, days: number, options: ScheduleWeekOptions): Promise<any[]> {
  const events = await mgc.getUpcomingEvents(days);
  
  if (!options.json) {
    console.log(chalk.green(`✓ ${events.length}件の予定を検出`));
  }
  
  return events;
}

/**
 * コンフリクトを検出してフィルタリング
 */
function detectAndFilterConflicts(
  events: any[],
  aiInstructions: any,
  options: ScheduleWeekOptions
): EventConflict[] {
  let conflicts = detectConflicts(events);
  
  // ConflictFilterクラスを使用してフィルタリング
  const conflictFilter = new ConflictFilter(aiInstructions);
  conflicts = conflictFilter.filterConflicts(conflicts, !options.json);
  
  return conflicts;
}

/**
 * 基本的な提案を作成
 */
function createBasicProposal(
  conflict: EventConflict,
  conflictIndex: number,
  rules: any
): Proposal {
  const eventsWithPriority = conflict.events.map((e: CalendarEvent) => {
    const priority = calculateEventPriority(e, rules);
    return { ...e, priority };
  });
  
  const sortedEvents = [...eventsWithPriority].sort((a, b) => b.priority.score - a.priority.score);
  const priorityDiff = sortedEvents[0].priority.score - sortedEvents[sortedEvents.length - 1].priority.score;
  const action = determineConflictAction(priorityDiff, rules);
  
  return {
    conflictId: `conflict-${conflictIndex}`,
    timeRange: formatDateTimeRange(conflict.startTime, conflict.endTime),
    events: sortedEvents.map(e => ({
      id: e.id,
      subject: e.subject,
      organizer: e.organizer?.emailAddress.address,
      attendeesCount: e.attendees?.length || 0,
      responseStatus: e.responseStatus?.response || 'none',
      priority: e.priority
    })),
    suggestion: {
      action: action.action,
      description: action.description,
      aiAnalysis: null
    }
  };
}

/**
 * AI分析結果を提案に適用
 */
function applyAIAnalysisToProposal(
  proposal: Proposal,
  aiResponse: any
): void {
  if (!aiResponse.success || !aiResponse.result) {
    proposal.suggestion.aiError = aiResponse.error;
    return;
  }
  
  const aiResult = aiResponse.result;
  
  proposal.suggestion = {
    action: getActionText(aiResult.recommendation.action, aiResult.recommendation.target),
    reason: aiResult.recommendation.reason,
    description: `AI分析による推奨（信頼度: ${aiResult.recommendation.confidence}）`,
    confidence: aiResult.recommendation.confidence,
    aiAnalysis: true,
    alternatives: aiResult.alternatives
  };
  
  if (proposal.events.length === 2) {
    if (proposal.events[0].priority) {
      proposal.events[0].priority.aiScore = aiResult.priority.event1.score;
      proposal.events[0].priority.aiReason = aiResult.priority.event1.reason;
    }
    if (proposal.events[1].priority) {
      proposal.events[1].priority.aiScore = aiResult.priority.event2.score;
      proposal.events[1].priority.aiReason = aiResult.priority.event2.reason;
    }
  }
}

/**
 * AI分析による提案を生成
 */
async function generateAIProposals(
  conflicts: EventConflict[],
  rules: any,
  aiInstructions: any,
  aiService: AIService,
  options: ScheduleWeekOptions
): Promise<Proposal[]> {
  // 基本的な提案を作成
  const proposals = conflicts.map((conflict, index) => 
    createBasicProposal(conflict, index, rules)
  );
  
  // AI分析を実行
  if (!options.json) {
    console.log(chalk.cyan('🤖 AI分析を実行中...'));
  }
  
  const timezone = process.env.OUTLOOK_AGENT_TIMEZONE || 'Asia/Tokyo';
  const systemPrompt = generateSystemPrompt(aiInstructions, rules, timezone);
  
  for (const proposal of proposals) {
    const conflictData = {
      timeRange: proposal.timeRange,
      events: proposal.events
    };
    
    const analysisPrompt = generateConflictAnalysisPrompt(conflictData, aiInstructions);
    const aiResponse = await aiService.analyzeConflictStructured(systemPrompt, analysisPrompt);
    applyAIAnalysisToProposal(proposal, aiResponse);
  }
  
  return proposals;
}

/**
 * ルールベースの提案を生成
 */
function generateRuleBasedProposals(conflicts: EventConflict[], rules: any): Proposal[] {
  const proposals = [];
  
  for (const conflict of conflicts) {
    const eventsWithPriority = conflict.events.map((e: CalendarEvent) => {
      const priority = calculateEventPriority(e, rules);
      return { ...e, priority };
    });
    
    const sortedEvents = [...eventsWithPriority].sort((a, b) => b.priority.score - a.priority.score);
    const priorityDiff = sortedEvents[0].priority.score - sortedEvents[sortedEvents.length - 1].priority.score;
    const action = determineConflictAction(priorityDiff, rules);
    
    const proposal: Proposal = {
      conflictId: `conflict-${conflicts.indexOf(conflict)}`,
      timeRange: formatDateTimeRange(conflict.startTime, conflict.endTime),
      events: sortedEvents.map(e => ({
        id: e.id,
        subject: e.subject,
        organizer: e.organizer?.emailAddress.address,
        attendeesCount: e.attendees?.length || 0,
        responseStatus: e.responseStatus?.response || 'none',
        priority: e.priority
      })),
      suggestion: generateAdvancedSuggestion(sortedEvents, action)
    };
    proposals.push(proposal);
  }
  
  return proposals;
}

/**
 * AI分析を試行
 */
async function tryAIAnalysis(
  conflicts: EventConflict[],
  config: Configuration,
  aiService: AIService,
  options: ScheduleWeekOptions
): Promise<Proposal[] | null> {
  try {
    await createSchedulerAgent(options.rules, options.instructions);
    
    if (!options.json) {
      const message = config.aiInstructionsResult.isDefault
        ? `AI指示ファイル: ${config.aiInstructionsResult.filePath} (デフォルト)`
        : `カスタムAI指示ファイル: ${config.aiInstructionsResult.filePath}`;
      console.log(chalk.gray(message));
    }
    
    return await generateAIProposals(
      conflicts,
      config.rules,
      config.aiInstructions,
      aiService,
      options
    );
  } catch (aiError) {
    if (!options.json) {
      console.warn(chalk.yellow('⚠️ AI分析中にエラーが発生しました。ルールベースの分析を使用します。'));
      if (process.env.DEBUG) {
        console.error(aiError);
      }
    }
    return null;
  }
}

/**
 * 提案を生成（AI統合版）
 */
async function generateProposals(
  conflicts: EventConflict[],
  config: Configuration,
  aiService: AIService,
  options: ScheduleWeekOptions
): Promise<Proposal[]> {
  if (!aiService.isAvailable()) {
    return generateRuleBasedProposals(conflicts, config.rules);
  }
  
  const aiProposals = await tryAIAnalysis(conflicts, config, aiService, options);
  return aiProposals || generateRuleBasedProposals(conflicts, config.rules);
}

/**
 * 提案のサマリーを表示
 */
function showProposalSummary(proposals: Proposal[], options: ScheduleWeekOptions): void {
  if (options.json) {
    return;
  }
  
  console.log(chalk.cyan('🤖 調整案を生成しました'));
  console.log(chalk.gray('━'.repeat(60)));
  console.log();
  
  console.log(chalk.bold('📋 コンフリクト一覧'));
  console.log();
  
  for (let i = 0; i < proposals.length; i++) {
    const proposal = proposals[i];
    console.log(chalk.yellow(`[${i + 1}] ${proposal.timeRange}`));
    
    for (const event of proposal.events) {
      const priorityLabel = event.priority ? `[${event.priority.level}:${event.priority.score}]` : '';
      console.log(`    • ${event.subject} ${chalk.gray(priorityLabel)}`);
    }
    
    const aiLabel = proposal.suggestion.aiAnalysis ? chalk.blue(' 🤖') : '';
    console.log(chalk.cyan(`    → ${proposal.suggestion.action}${aiLabel}`));
    if (proposal.suggestion.confidence) {
      console.log(chalk.gray(`       信頼度: ${proposal.suggestion.confidence}`));
    }
    console.log();
  }
  
  console.log(chalk.gray('━'.repeat(60)));
  console.log();
}

/**
 * イベントの詳細を表示
 */
function showEventDetails(event: ProposalEvent): void {
  console.log(`  📅 ${event.subject}`);
  console.log(`     主催者: ${event.organizer || 'なし'}`);
  console.log(`     参加者: ${event.attendeesCount}名`);
  console.log(`     ステータス: ${event.responseStatus}`);
  if (event.priority) {
    console.log(`     優先度: ${event.priority.level} (スコア: ${event.priority.score})`);
    if (event.priority.reasons.length > 0) {
      console.log(`     判定理由: ${event.priority.reasons.join(', ')}`);
    }
  }
}

/**
 * 詳細レビューを表示
 */
function showDetailedReview(proposals: Proposal[]): void {
  console.log();
  console.log(chalk.cyan('📋 提案の詳細'));
  console.log(chalk.gray('─'.repeat(60)));
  
  for (let i = 0; i < proposals.length; i++) {
    const proposal = proposals[i];
    console.log();
    console.log(chalk.yellow(`[コンフリクト ${i + 1}/${proposals.length}]`));
    console.log(chalk.gray(`時間: ${proposal.timeRange}`));
    console.log();
    
    for (const event of proposal.events) {
      showEventDetails(event);
    }
    
    console.log();
    console.log(chalk.cyan('提案:'), proposal.suggestion.action);
    if ('reason' in proposal.suggestion) {
      console.log(chalk.gray('理由:'), proposal.suggestion.reason);
    }
    
    // AI分析結果の表示
    if (proposal.suggestion.aiAnalysis) {
      console.log(chalk.blue('🤖 AI分析:'), `信頼度: ${proposal.suggestion.confidence || 'N/A'}`);
      if (proposal.suggestion.alternatives && proposal.suggestion.alternatives.length > 0) {
        console.log(chalk.gray('  代替案:'));
        proposal.suggestion.alternatives.forEach((alt: string, idx: number) => {
          console.log(`    ${idx + 1}. ${alt}`);
        });
      }
    }
  }
  
  console.log();
  console.log(chalk.gray('─'.repeat(60)));
}

/**
 * ユーザーインタラクションを処理
 */
async function handleUserInteraction(
  proposals: Proposal[],
  mgc: MgcService,
  memory: DecisionMemory,
  options: ScheduleWeekOptions
): Promise<void> {
  // ドライランモードの場合
  if (options.dryRun) {
    console.log();
    console.log(chalk.yellow('ドライランモードのため、実際の変更は行われませんでした'));
    console.log(chalk.green('✓ スケジュール調整案の生成が完了しました！'));
    return;
  }
  
  // 学習パターンを表示
  const suggestedPatterns = await memory.suggestPattern();
  if (suggestedPatterns.length > 0) {
    console.log(chalk.yellow('📊 過去の判断パターン：'));
    for (const pattern of suggestedPatterns) {
      console.log(`  - ${pattern.description}: 承認率 ${Math.round(pattern.approvalRate * 100)}% (サンプル数: ${pattern.sampleCount})`);
    }
    console.log();
  }
  
  // バッチ処理の選択肢を提示
  const { batchAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'batchAction',
      message: 'どのように処理しますか？',
      choices: [
        { name: '✅ すべての提案を適用', value: 'apply_all' },
        { name: '✏️  個別に修正', value: 'modify_selective' },
        { name: '📝 詳細を確認', value: 'review_details' },
        { name: '❌ キャンセル', value: 'cancel' }
      ]
    }
  ]);
  
  if (batchAction === 'cancel') {
    console.log(chalk.yellow('調整をキャンセルしました'));
    return;
  }
  
  if (batchAction === 'review_details') {
    showDetailedReview(proposals);
    
    const { afterReview } = await inquirer.prompt([
      {
        type: 'list',
        name: 'afterReview',
        message: '詳細を確認しました。どのように処理しますか？',
        choices: [
          { name: '✅ すべての提案を適用', value: 'apply_all' },
          { name: '✏️  個別に修正', value: 'modify_selective' },
          { name: '❌ キャンセル', value: 'cancel' }
        ]
      }
    ]);
    
    if (afterReview === 'cancel') {
      console.log(chalk.yellow('調整をキャンセルしました'));
      return;
    }
    
    if (afterReview === 'apply_all') {
      await applyAllProposals(proposals, mgc, memory);
    } else if (afterReview === 'modify_selective') {
      await selectiveModification(proposals, mgc, memory);
    }
  } else if (batchAction === 'apply_all') {
    await applyAllProposals(proposals, mgc, memory);
  } else if (batchAction === 'modify_selective') {
    await selectiveModification(proposals, mgc, memory);
  }
  
  console.log();
  console.log(chalk.green('✓ スケジュール調整が完了しました！'));
  
  // 統計情報を表示
  const stats = await memory.getStatistics();
  if (stats.totalDecisions > 0) {
    console.log();
    console.log(chalk.cyan('📈 学習統計（過去30日）：'));
    console.log(`  総判断数: ${stats.totalDecisions}`);
    console.log(`  承認率: ${Math.round(stats.approvalRate * 100)}%`);
    console.log(`  修正率: ${Math.round(stats.modificationRate * 100)}%`);
    console.log(`  スキップ率: ${Math.round(stats.skipRate * 100)}%`);
  }
}

export async function scheduleWeek(options: ScheduleWeekOptions): Promise<void> {
  const mgc = new MgcService();
  const memory = new DecisionMemory();
  const aiService = new AIService(process.env.OUTLOOK_AGENT_MODEL || 'gpt-4o-mini');
  
  try {
    // 設定を初期化
    const config = await initializeConfiguration(options);
    
    if (!options.json) {
      console.log(chalk.cyan('📊 週次スケジュール分析中...'));
      console.log(chalk.gray(`タイムゾーン: ${config.timezone}`));
      console.log(chalk.gray(`モデル: ${config.model}`));
      console.log(chalk.gray(`期間: ${config.startDate.toLocaleDateString()} から ${config.days}日間`));
      if (options.dryRun) {
        console.log(chalk.yellow('⚠️  ドライランモード: 実際の変更は行いません'));
      }
      console.log();
    }
    
    // イベントを取得
    const events = await fetchEvents(mgc, config.days, options);
    
    // コンフリクトを検出してフィルタリング
    const conflicts = detectAndFilterConflicts(events, config.aiInstructions, options);
    
    if (conflicts.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({
          status: 'success',
          message: 'No conflicts found',
          events: events.length,
          conflicts: 0,
          proposals: []
        }, null, 2));
      } else {
        console.log(chalk.green('✓ スケジュールにコンフリクトはありません！'));
      }
      return;
    }
    
    if (!options.json) {
      console.log(chalk.yellow(`⚠️  ${conflicts.length}件のコンフリクトを発見`));
      console.log();
      
      if (config.rulesResult.isDefault) {
        console.log(chalk.gray(`ルールファイル: ${config.rulesResult.filePath} (デフォルト)`));
      } else {
        console.log(chalk.cyan(`カスタムルールファイル: ${config.rulesResult.filePath}`));
      }
    }
    
    // 提案を生成
    const proposals = await generateProposals(conflicts, config, aiService, options);
    
    // JSON出力モード
    if (options.json) {
      console.log(JSON.stringify({
        status: 'success',
        events: events.length,
        conflicts: conflicts.length,
        proposals,
        dryRun: options.dryRun || false,
        timezone: config.timezone,
        model: config.model
      }, null, 2));
      return;
    }
    
    // 提案のサマリーを表示
    showProposalSummary(proposals, options);
    
    // ユーザーインタラクションを処理
    await handleUserInteraction(proposals, mgc, memory, options);
    
  } catch (error: any) {
    if (options.json) {
      console.log(JSON.stringify({
        status: 'error',
        error: error.message || error
      }, null, 2));
    } else {
      console.error(chalk.red('スケジュール調整に失敗しました:'), error.message || error);
    }
    process.exit(1);
  }
}

/**
 * イベント処理結果のインターフェース
 */
interface EventProcessResult {
  eventId: string;
  eventSubject: string;
  success: boolean;
  details?: string;
  error?: string;
}

/**
 * 複数イベント処理の集約結果
 */
interface ApplyResult {
  success: boolean;
  details?: string;
  error?: string;
  results?: EventProcessResult[];
  summary?: {
    total: number;
    successful: number;
    failed: number;
  };
}

/**
 * 単一イベントのリスケジュール処理
 */
async function rescheduleEvent(
  event: ProposalEvent,
  mgc: MgcService
): Promise<EventProcessResult> {
  try {
    // イベント詳細を取得してattendees情報を取得
    const eventDetails = await mgc.getEvent(event.id);
    const attendees = eventDetails.attendees || [];
    const attendeeEmails = attendees.map((a: any) => a.emailAddress.address);
    
    const meetingTimes = await mgc.findMeetingTimes({
      attendees: attendeeEmails.map((email: string) => ({
        emailAddress: { address: email }
      })),
      timeConstraint: {
        timeslots: [{
          start: { 
            dateTime: new Date().toISOString(),
            timeZone: process.env.OUTLOOK_AGENT_TIMEZONE || 'Asia/Tokyo'
          },
          end: {
            dateTime: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            timeZone: process.env.OUTLOOK_AGENT_TIMEZONE || 'Asia/Tokyo'
          }
        }]
      },
      meetingDuration: 'PT30M',
      maxCandidates: 5
    });
    
    if (meetingTimes.meetingTimeSuggestions && meetingTimes.meetingTimeSuggestions.length > 0) {
      const newTime = meetingTimes.meetingTimeSuggestions[0];
      
      // イベントを更新
      await mgc.updateEvent(event.id, {
        start: newTime.meetingTimeSlot.start,
        end: newTime.meetingTimeSlot.end,
      });
      
      return {
        eventId: event.id,
        eventSubject: event.subject,
        success: true,
        details: `${new Date(newTime.meetingTimeSlot.start.dateTime).toLocaleString('ja-JP')}にリスケジュール完了`
      };
    } else {
      return {
        eventId: event.id,
        eventSubject: event.subject,
        success: false,
        error: '適切な代替時間が見つかりませんでした'
      };
    }
  } catch (error) {
    return {
      eventId: event.id,
      eventSubject: event.subject,
      success: false,
      error: error instanceof Error ? error.message : '不明なエラー'
    };
  }
}

/**
 * 単一イベントの辞退処理
 */
async function declineEvent(
  event: ProposalEvent,
  mgc: MgcService
): Promise<EventProcessResult> {
  try {
    // イベントへの返信を更新（辞退）
    await mgc.updateEventResponse(event.id, 'decline');
    
    return {
      eventId: event.id,
      eventSubject: event.subject,
      success: true,
      details: '辞退完了'
    };
  } catch (error) {
    return {
      eventId: event.id,
      eventSubject: event.subject,
      success: false,
      error: error instanceof Error ? error.message : '不明なエラー'
    };
  }
}

/**
 * 対象イベントを特定する共通関数
 */
function getTargetEvents(proposal: Proposal): ProposalEvent[] {
  const highestPriorityScore = Math.max(...proposal.events.map(e => e.priority?.score || 0));
  return proposal.events.filter(e => 
    (e.priority?.score || 0) < highestPriorityScore
  );
}

/**
 * 複数イベントを順次処理する共通関数
 */
async function processMultipleEvents(
  events: ProposalEvent[],
  processFunction: (event: ProposalEvent, mgc: MgcService) => Promise<EventProcessResult>,
  mgc: MgcService
): Promise<EventProcessResult[]> {
  const results: EventProcessResult[] = [];
  for (const event of events) {
    const result = await processFunction(event, mgc);
    results.push(result);
  }
  return results;
}

/**
 * 処理結果を集約する共通関数
 */
function aggregateResults(results: EventProcessResult[]) {
  const successCount = results.filter(r => r.success).length;
  const failCount = results.length - successCount;
  
  return {
    results,
    summary: {
      total: results.length,
      successful: successCount,
      failed: failCount
    },
    successCount,
    failCount
  };
}

/**
 * 処理結果からレスポンスを生成する共通関数
 */
function generateProcessingResponse(
  aggregatedResults: ReturnType<typeof aggregateResults>,
  actionType: 'reschedule' | 'decline'
): ApplyResult {
  const { results, summary, successCount, failCount } = aggregatedResults;
  
  const actionText = actionType === 'reschedule' ? 'リスケジュール' : '辞退';
  
  if (successCount === results.length) {
    // すべて成功
    const eventNames = results.map(r => `「${r.eventSubject}」`).join('、');
    return {
      success: true,
      details: `${eventNames}の${actionText}が完了しました`,
      results,
      summary
    };
  } else if (successCount > 0) {
    // 部分成功
    const successNames = results.filter(r => r.success).map(r => `「${r.eventSubject}」`).join('、');
    const failNames = results.filter(r => !r.success).map(r => `「${r.eventSubject}」`).join('、');
    return {
      success: false,
      details: `成功: ${successNames}`,
      error: `失敗: ${failNames}`,
      results,
      summary
    };
  } else {
    // すべて失敗
    return {
      success: false,
      error: `すべての${actionText}に失敗しました（${failCount}件）`,
      results,
      summary
    };
  }
}

/**
 * 提案された変更を適用（複数イベント対応、リファクタリング版）
 */
async function applyProposedChanges(
  proposal: Proposal,
  mgc: MgcService,
  dryRun?: boolean
): Promise<ApplyResult> {
  if (dryRun) {
    return { 
      success: true, 
      details: 'ドライランモードのため、実際の変更は行われませんでした' 
    };
  }
  
  try {
    const suggestion = proposal.suggestion;
    const targetEvents = getTargetEvents(proposal);
    
    if (targetEvents.length === 0) {
      const actionText = suggestion.action.includes('リスケジュール') ? 'リスケジュール' : '辞退';
      return {
        success: false,
        error: `${actionText}対象のイベントが見つかりません`
      };
    }
    
    if (suggestion.action.includes('リスケジュール')) {
      const results = await processMultipleEvents(targetEvents, rescheduleEvent, mgc);
      const aggregated = aggregateResults(results);
      return generateProcessingResponse(aggregated, 'reschedule');
    }
    
    if (suggestion.action.includes('辞退')) {
      const results = await processMultipleEvents(targetEvents, declineEvent, mgc);
      const aggregated = aggregateResults(results);
      return generateProcessingResponse(aggregated, 'decline');
    }
    
    return {
      success: false,
      error: '未対応のアクションタイプです'
    };
    
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '不明なエラー'
    };
  }
}

/**
 * 提案を手動で修正
 */
async function modifyProposal(proposal: Proposal): Promise<Proposal | null> {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'どのような修正を行いますか？',
      choices: [
        { name: '異なるイベントをリスケジュール', value: 'change_target' },
        { name: '特定の時間帯を指定', value: 'specify_time' },
        { name: '辞退に変更', value: 'change_to_decline' },
        { name: 'キャンセル', value: 'cancel' }
      ]
    }
  ]);
  
  if (action === 'cancel') {
    return null;
  }
  
  const modifiedProposal = { ...proposal };
  
  switch (action) {
    case 'change_target': {
      const { targetEvent } = await inquirer.prompt([
        {
          type: 'list',
          name: 'targetEvent',
          message: 'どのイベントをリスケジュールしますか？',
          choices: proposal.events.map((e: any) => ({
            name: `${e.subject} (優先度: ${e.priority?.level || 'なし'})`,
            value: e.id
          }))
        }
      ]);
      
      modifiedProposal.suggestion.targetEventId = targetEvent;
      modifiedProposal.suggestion.action = `選択されたイベントをリスケジュール`;
      break;
    }
      
    case 'specify_time': {
      const { dateStr, timeStr } = await inquirer.prompt([
        {
          type: 'input',
          name: 'dateStr',
          message: '新しい日付 (YYYY-MM-DD):',
          validate: (input) => /^\d{4}-\d{2}-\d{2}$/.test(input) || '正しい形式で入力してください'
        },
        {
          type: 'input',
          name: 'timeStr',
          message: '新しい時刻 (HH:MM):',
          validate: (input) => /^\d{2}:\d{2}$/.test(input) || '正しい形式で入力してください'
        }
      ]);
      
      modifiedProposal.suggestion.specificTime = `${dateStr}T${timeStr}:00`;
      break;
    }
      
    case 'change_to_decline':
      modifiedProposal.suggestion.action = '辞退';
      modifiedProposal.suggestion.reason = 'ユーザーの判断により辞退';
      break;
  }
  
  return modifiedProposal;
}

/**
 * AIアクションをテキストに変換
 */
function getActionText(action: string, target: string): string {
  switch (action) {
    case 'reschedule':
      // targetに複数のイベントが含まれている場合を考慮
      if (target.includes('、')) {
        return `${target}を別の時間にリスケジュール`;
      } else {
        return `「${target}」を別の時間にリスケジュール`;
      }
    case 'decline':
      if (target.includes('、')) {
        return `${target}を辞退`;
      } else {
        return `「${target}」を辞退`;
      }
    case 'keep':
      return `すべての会議を維持（手動調整が必要）`;
    default:
      return action;
  }
}

// 高度な提案生成（ルールベース）
function generateAdvancedSuggestion(sortedEvents: any[], action: any): ProposalSuggestion {
  const highPriorityEvent = sortedEvents[0];
  const lowPriorityEvents = sortedEvents.slice(1); // 最高優先度以外のすべての予定
  
  let suggestionAction = '';
  let reason = '';
  
  if (action.action === 'reschedule_lower_priority') {
    if (lowPriorityEvents.length === 1) {
      // 2つの予定の場合の既存ロジック
      const lowPriorityEvent = lowPriorityEvents[0];
      suggestionAction = `「${lowPriorityEvent.subject}」を別の時間にリスケジュール`;
      reason = `「${highPriorityEvent.subject}」の方が優先度が高いため（${highPriorityEvent.priority.level}: ${highPriorityEvent.priority.score} vs ${lowPriorityEvent.priority.level}: ${lowPriorityEvent.priority.score}）`;
    } else {
      // 3つ以上の予定の場合は複数をリスケジュール
      const eventNames = lowPriorityEvents.map(e => `「${e.subject}」`).join('、');
      suggestionAction = `${eventNames}を別の時間にリスケジュール`;
      reason = `「${highPriorityEvent.subject}」の方が優先度が高いため（${highPriorityEvent.priority.level}: ${highPriorityEvent.priority.score}）`;
    }
  } else if (action.action === 'suggest_reschedule') {
    if (lowPriorityEvents.length === 1) {
      const lowPriorityEvent = lowPriorityEvents[0];
      suggestionAction = `「${lowPriorityEvent.subject}」のリスケジュールを検討`;
      reason = `優先度の差があるため（${highPriorityEvent.priority.score - lowPriorityEvent.priority.score}ポイント差）`;
    } else {
      const eventNames = lowPriorityEvents.map(e => `「${e.subject}」`).join('、');
      suggestionAction = `${eventNames}のリスケジュールを検討`;
      reason = `「${highPriorityEvent.subject}」の方が優先度が高いため`;
    }
  } else if (lowPriorityEvents.length === 1) {
    const lowPriorityEvent = lowPriorityEvents[0];
    suggestionAction = `手動での判断が必要`;
    reason = `優先度が近いため、ビジネス判断が必要（${highPriorityEvent.priority.score} vs ${lowPriorityEvent.priority.score}）`;
  } else {
    suggestionAction = `手動での判断が必要`;
    reason = `複数の予定が同じ優先度のため、ビジネス判断が必要`;
  }
  
  return {
    action: suggestionAction,
    reason: reason,
    description: action.description
  };
}

/**
 * 処理結果を表示し、カウンターを更新する共通関数
 */
function handleProcessingResult(
  result: ApplyResult,
  actionLabel: string,
  counters: { success: number; error: number; modify?: number }
): { success: number; error: number; modify?: number } {
  if (result.success) {
    console.log(chalk.green(`  ✓ ${actionLabel}`));
    if (result.details) {
      console.log(chalk.gray(`    ${result.details}`));
    }
    
    // 複数イベント処理の統計情報表示
    if (result.summary && result.summary.total > 1) {
      console.log(chalk.gray(`    処理統計: ${result.summary.successful}/${result.summary.total}件成功`));
    }
    return { ...counters, success: counters.success + 1 };
  } else {
    console.log(chalk.red(`  ✗ 失敗: ${result.error}`));
    if (result.details) {
      console.log(chalk.yellow(`    部分成功: ${result.details}`));
    }
    
    // 複数イベント処理の詳細エラー情報
    if (result.summary && result.summary.total > 1) {
      console.log(chalk.gray(`    処理統計: ${result.summary.successful}/${result.summary.total}件成功, ${result.summary.failed}件失敗`));
    }
    return { ...counters, error: counters.error + 1 };
  }
}

/**
 * すべての提案を適用
 */
async function applyAllProposals(
  proposals: Proposal[],
  mgc: MgcService,
  memory: DecisionMemory
): Promise<void> {
  console.log();
  console.log(chalk.cyan('🚀 すべての提案を適用中...'));
  console.log();
  
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < proposals.length; i++) {
    const proposal = proposals[i];
    console.log(chalk.gray(`[${i + 1}/${proposals.length}] ${proposal.timeRange}`));
    
    try {
      // 判断を記録
      const decision = memory.createDecisionRecord(
        { timeRange: proposal.timeRange, events: proposal.events },
        proposal,
        'approve'
      );
      await memory.recordDecision(decision);
      
      // 実際の変更を適用
      const result = await applyProposedChanges(proposal, mgc, false);
      const counters = handleProcessingResult(result, proposal.suggestion.action, { success: successCount, error: errorCount });
      successCount = counters.success;
      errorCount = counters.error;
    } catch (error) {
      console.log(chalk.red(`  ✗ エラー: ${error}`));
      errorCount++;
    }
  }
  
  console.log();
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.green(`✓ 成功: ${successCount}件`));
  if (errorCount > 0) {
    console.log(chalk.red(`✗ 失敗: ${errorCount}件`));
  }
  console.log();
  console.log(chalk.green('✓ バッチ処理が完了しました！'));
}

/**
 * 選択的修正モード
 */
async function selectiveModification(
  proposals: Proposal[],
  mgc: MgcService,
  memory: DecisionMemory
): Promise<void> {
  console.log();
  console.log(chalk.cyan('🔍 修正する項目を選択してください'));
  console.log(chalk.gray('※ 選択された項目のみ手動修正、それ以外は自動適用されます'));
  console.log();
  
  // チェックボックス形式で修正する項目を選択
  const { selectedIndices } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedIndices',
      message: '修正する項目を選択:',
      choices: proposals.map((proposal, index) => ({
        name: `[${index + 1}] ${proposal.timeRange} - ${proposal.suggestion.action}`,
        value: index
      }))
    }
  ]);
  
  console.log();
  let successCount = 0;
  let errorCount = 0;
  let modifyCount = 0;
  
  for (let i = 0; i < proposals.length; i++) {
    const proposal = proposals[i];
    console.log(chalk.gray(`[${i + 1}/${proposals.length}] ${proposal.timeRange}`));
    
    // 選択された項目は手動修正
    if (selectedIndices.includes(i)) {
      console.log(chalk.yellow('  ✏️  手動修正モード'));
      
      // 詳細を表示
      console.log();
      for (const event of proposal.events) {
        console.log(`    • ${event.subject}`);
        console.log(`      優先度: ${event.priority?.level} (スコア: ${event.priority?.score})`);
      }
      console.log(`    現在の提案: ${proposal.suggestion.action}`);
      console.log();
      
      const modifiedProposal = await modifyProposal(proposal);
      if (modifiedProposal) {
        // 判断を記録
        const decision = memory.createDecisionRecord(
          { timeRange: proposal.timeRange, events: proposal.events },
          proposal,
          'modify',
          modifiedProposal.suggestion.action
        );
        await memory.recordDecision(decision);
        
        try {
          const result = await applyProposedChanges(modifiedProposal, mgc, false);
          const counters = handleProcessingResult(result, `修正を適用: ${modifiedProposal.suggestion.action}`, 
            { success: modifyCount, error: errorCount });
          modifyCount = counters.success;
          errorCount = counters.error;
        } catch (error) {
          console.log(chalk.red(`  ✗ エラー: ${error}`));
          errorCount++;
        }
      } else {
        console.log(chalk.yellow('  - スキップ'));
      }
    }
    // 選択されていない項目は自動適用
    else {
      try {
        // 判断を記録
        const decision = memory.createDecisionRecord(
          { timeRange: proposal.timeRange, events: proposal.events },
          proposal,
          'approve'
        );
        await memory.recordDecision(decision);
        
        // 実際の変更を適用
        const result = await applyProposedChanges(proposal, mgc, false);
        const counters = handleProcessingResult(result, `自動適用: ${proposal.suggestion.action}`, 
          { success: successCount, error: errorCount });
        successCount = counters.success;
        errorCount = counters.error;
      } catch (error) {
        console.log(chalk.red(`  ✗ エラー: ${error}`));
        errorCount++;
      }
    }
  }
  
  console.log();
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.green(`✓ 自動適用: ${successCount}件`));
  if (modifyCount > 0) {
    console.log(chalk.yellow(`✏️  手動修正: ${modifyCount}件`));
  }
  if (errorCount > 0) {
    console.log(chalk.red(`✗ 失敗: ${errorCount}件`));
  }
  console.log();
  console.log(chalk.green('✓ 選択的修正が完了しました！'));
}