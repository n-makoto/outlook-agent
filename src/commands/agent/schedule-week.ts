import { MgcService } from '../../services/mgc.js';
import { detectConflicts } from '../../utils/conflicts.js';
import { formatDateTimeRange } from '../../utils/format.js';
import { createSchedulerAgent } from '../../agents/scheduler/index.js';
import { calculateEventPriority, loadSchedulingRules, determineConflictAction } from '../../utils/rules.js';
import { loadAIInstructions, generateConflictAnalysisPrompt, generateSystemPrompt } from '../../utils/ai-prompt.js';
import { DecisionMemory } from '../../agents/scheduler/memory.js';
import { AIService } from '../../services/ai.js';
import chalk from 'chalk';
import inquirer from 'inquirer';

interface ScheduleWeekOptions {
  dryRun?: boolean;
  date?: string;
  json?: boolean;
  rules?: string;
  instructions?: string;  // AI指示設定ファイルのパス
}

export async function scheduleWeek(options: ScheduleWeekOptions): Promise<void> {
  const mgc = new MgcService();
  const memory = new DecisionMemory();
  const aiService = new AIService(process.env.OUTLOOK_AGENT_MODEL || 'gpt-4o-mini');
  
  try {
    // 設定の読み込み（環境変数優先）
    const timezone = process.env.OUTLOOK_AGENT_TIMEZONE || process.env.TZ || 'Asia/Tokyo';
    const model = process.env.OUTLOOK_AGENT_MODEL || 'gpt-4o-mini';
    
    // 開始日の決定
    const startDate = options.date ? new Date(options.date) : new Date();
    const days = 7;
    
    if (!options.json) {
      console.log(chalk.cyan('📊 週次スケジュール分析中...'));
      console.log(chalk.gray(`タイムゾーン: ${timezone}`));
      console.log(chalk.gray(`モデル: ${model}`));
      console.log(chalk.gray(`期間: ${startDate.toLocaleDateString()} から ${days}日間`));
      if (options.dryRun) {
        console.log(chalk.yellow('⚠️  ドライランモード: 実際の変更は行いません'));
      }
      console.log();
    }
    
    // 予定の取得
    const events = await mgc.getUpcomingEvents(days);
    
    if (!options.json) {
      console.log(chalk.green(`✓ ${events.length}件の予定を検出`));
    }
    
    // コンフリクトの検出
    let conflicts = detectConflicts(events);
    
    // AI指示設定を読み込んで特別ルールを適用
    const aiInstructionsResult = await loadAIInstructions(options.instructions);
    const aiInstructions = aiInstructionsResult.instructions;
    
    // ignore_conflictsルールに基づいてコンフリクトをフィルタリング
    const ignoreRules = aiInstructions.custom_rules?.ignore_conflicts;
    if (ignoreRules && ignoreRules.length > 0) {
      conflicts = conflicts.filter(conflict => {
        // 各ignore_conflictルールをチェック
        for (const rule of ignoreRules) {
          let shouldIgnore = true;
          
          for (const condition of rule.conditions) {
            // 曜日のチェック
            if (condition.day_of_week) {
              const conflictDate = new Date(conflict.startTime);
              const dayMap: { [key: string]: number } = {
                'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
                'Thursday': 4, 'Friday': 5, 'Saturday': 6
              };
              if (dayMap[condition.day_of_week] !== conflictDate.getDay()) {
                shouldIgnore = false;
                break;
              }
            }
            
            // 時刻のチェック
            if (condition.time) {
              const conflictDate = new Date(conflict.startTime);
              const [hour] = condition.time.split(':').map(Number);
              if (conflictDate.getHours() !== hour) {
                shouldIgnore = false;
                break;
              }
            }
            
            // イベントパターンのチェック
            if (condition.event1_pattern && condition.event2_pattern) {
              const hasEvent1 = conflict.events.some(e => 
                e.subject.includes(condition.event1_pattern!)
              );
              const hasEvent2 = conflict.events.some(e => 
                e.subject.includes(condition.event2_pattern!)
              );
              if (!hasEvent1 || !hasEvent2) {
                shouldIgnore = false;
                break;
              }
            }
          }
          
          if (shouldIgnore) {
            if (!options.json) {
              console.log(chalk.gray(`特別ルール適用: ${rule.description}`));
            }
            return false; // このコンフリクトを除外
          }
        }
        
        return true; // このコンフリクトを保持
      });
    }
    
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
    }
    
    // スケジューリングルールを読み込む
    const rulesResult = await loadSchedulingRules(options.rules);
    const rules = rulesResult.rules;
    
    if (!options.json) {
      if (rulesResult.isDefault) {
        console.log(chalk.gray(`ルールファイル: ${rulesResult.filePath} (デフォルト)`));
      } else {
        console.log(chalk.cyan(`カスタムルールファイル: ${rulesResult.filePath}`));
      }
    }
    
    // 調整案の生成（AI統合版）
    const proposals = [];
    
    // AIエージェントを使用する場合
    const useAI = aiService.isAvailable();
    
    if (useAI) {
      try {
        // AIエージェントを作成（カスタムルールと指示を使用）
        // const agent = await createSchedulerAgent(options.rules, options.instructions);
        await createSchedulerAgent(options.rules, options.instructions);
        
        if (!options.json && aiInstructionsResult.isDefault) {
          console.log(chalk.gray(`AI指示ファイル: ${aiInstructionsResult.filePath} (デフォルト)`));
        } else if (!options.json && !aiInstructionsResult.isDefault) {
          console.log(chalk.cyan(`カスタムAI指示ファイル: ${aiInstructionsResult.filePath}`));
        }
        
        // 各コンフリクトを分析
        for (const conflict of conflicts) {
          // イベントの優先度を計算
          const eventsWithPriority = conflict.events.map(e => {
            const priority = calculateEventPriority(e, rules);
            return {
              ...e,
              priority
            };
          });
          
          // 優先度でソート
          const sortedEvents = [...eventsWithPriority].sort((a, b) => b.priority.score - a.priority.score);
          const priorityDiff = sortedEvents[0].priority.score - sortedEvents[sortedEvents.length - 1].priority.score;
          const action = determineConflictAction(priorityDiff, rules);
          
          const proposal = {
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
            suggestion: {
              action: action.action,
              description: action.description,
              aiAnalysis: null // AI分析結果を格納予定
            }
          };
          
          proposals.push(proposal);
        }
        
        if (!options.json) {
          console.log(chalk.cyan('🤖 AI分析を実行中...'));
        }
        
        // AI分析用のプロンプトを生成
        if (!options.json) {
          console.log(chalk.cyan('🤖 AI分析を実行中...'));
        }
        
        const systemPrompt = generateSystemPrompt(aiInstructions, rules, timezone);
        
        for (let i = 0; i < proposals.length; i++) {
          const proposal = proposals[i];
          const conflictData = {
            timeRange: proposal.timeRange,
            events: proposal.events
          };
          
          // カスタマイズされたプロンプトを生成
          const analysisPrompt = generateConflictAnalysisPrompt(conflictData, aiInstructions);
          
          // AI分析を実行
          const aiResponse = await aiService.analyzeConflictStructured(systemPrompt, analysisPrompt);
          
          if (aiResponse.success && aiResponse.result) {
            // AIの分析結果を使用
            const aiResult = aiResponse.result;
            
            // AIの推奨を提案に反映
            (proposal as any).suggestion = {
              action: getActionText(aiResult.recommendation.action, aiResult.recommendation.target),
              reason: aiResult.recommendation.reason,
              description: `AI分析による推奨（信頼度: ${aiResult.recommendation.confidence}）`,
              confidence: aiResult.recommendation.confidence,
              aiAnalysis: true,
              alternatives: aiResult.alternatives
            };
            
            // イベントの優先度をAI分析結果で更新
            if (proposal.events.length === 2) {
              (proposal.events[0].priority as any).aiScore = aiResult.priority.event1.score;
              (proposal.events[0].priority as any).aiReason = aiResult.priority.event1.reason;
              (proposal.events[1].priority as any).aiScore = aiResult.priority.event2.score;
              (proposal.events[1].priority as any).aiReason = aiResult.priority.event2.reason;
            }
          } else {
            // AI分析が失敗した場合はルールベースの結果を維持
            (proposal.suggestion as any).aiError = aiResponse.error;
          }
        }
        
      } catch (aiError) {
        if (!options.json) {
          console.warn(chalk.yellow('⚠️ AI分析中にエラーが発生しました。ルールベースの分析を使用します。'));
          if (process.env.DEBUG) {
            console.error(aiError);
          }
        }
      }
    }
    
    // AIが使用できない場合、またはエラーの場合はルールベースの分析
    if (!useAI || proposals.length === 0) {
      for (const conflict of conflicts) {
        // ルールベースで優先度を計算
        const eventsWithPriority = conflict.events.map(e => {
          const priority = calculateEventPriority(e, rules);
          return { ...e, priority };
        });
        
        const sortedEvents = [...eventsWithPriority].sort((a, b) => b.priority.score - a.priority.score);
        const priorityDiff = sortedEvents[0].priority.score - sortedEvents[sortedEvents.length - 1].priority.score;
        const action = determineConflictAction(priorityDiff, rules);
        
        const proposal = {
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
    }
    
    // JSON出力モード
    if (options.json) {
      console.log(JSON.stringify({
        status: 'success',
        events: events.length,
        conflicts: conflicts.length,
        proposals,
        dryRun: options.dryRun || false,
        timezone,
        model
      }, null, 2));
      return;
    }
    
    // バッチ承認モード
    console.log(chalk.cyan('🤖 調整案を生成しました'));
    console.log(chalk.gray('━'.repeat(60)));
    console.log();
    
    // 全提案のサマリー表示
    console.log(chalk.bold('📋 コンフリクト一覧'));
    console.log();
    
    for (let i = 0; i < proposals.length; i++) {
      const proposal = proposals[i];
      console.log(chalk.yellow(`[${i + 1}] ${proposal.timeRange}`));
      
      // 関連イベントを簡潔に表示
      for (const event of proposal.events) {
        const priorityLabel = event.priority ? `[${event.priority.level}:${event.priority.score}]` : '';
        console.log(`    • ${event.subject} ${chalk.gray(priorityLabel)}`);
      }
      
      // 提案内容を表示
      const aiLabel = (proposal.suggestion as any).aiAnalysis ? chalk.blue(' 🤖') : '';
      console.log(chalk.cyan(`    → ${proposal.suggestion.action}${aiLabel}`));
      if ((proposal.suggestion as any).confidence) {
        console.log(chalk.gray(`       信頼度: ${(proposal.suggestion as any).confidence}`));
      }
      console.log();
    }
    
    console.log(chalk.gray('━'.repeat(60)));
    console.log();
    
    // 学習パターンを読み込み
    const suggestedPatterns = await memory.suggestPattern();
    if (suggestedPatterns.length > 0) {
      console.log(chalk.yellow('📊 過去の判断パターン：'));
      for (const pattern of suggestedPatterns) {
        console.log(`  - ${pattern.description}: 承認率 ${Math.round(pattern.approvalRate * 100)}% (サンプル数: ${pattern.sampleCount})`);
      }
      console.log();
    }
    
    // ドライランモードの場合は全提案を実行せずに終了
    if (options.dryRun) {
      console.log();
      console.log(chalk.yellow('ドライランモードのため、実際の変更は行われませんでした'));
      console.log(chalk.green('✓ スケジュール調整案の生成が完了しました！'));
      return;
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
    
    // 詳細確認モード
    if (batchAction === 'review_details') {
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
        
        console.log();
        console.log(chalk.cyan('提案:'), proposal.suggestion.action);
        if ('reason' in proposal.suggestion) {
          console.log(chalk.gray('理由:'), proposal.suggestion.reason);
        }
        
        // AI分析結果の表示
        if ((proposal.suggestion as any).aiAnalysis) {
          console.log(chalk.blue('🤖 AI分析:'), `信頼度: ${(proposal.suggestion as any).confidence || 'N/A'}`);
          if ((proposal.suggestion as any).alternatives?.length > 0) {
            console.log(chalk.gray('  代替案:'));
            (proposal.suggestion as any).alternatives.forEach((alt: string, idx: number) => {
              console.log(`    ${idx + 1}. ${alt}`);
            });
          }
        }
      }
      
      console.log();
      console.log(chalk.gray('─'.repeat(60)));
      
      // 詳細確認後に再度選択肢を提示
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
    }
    
    // すべての提案を適用
    else if (batchAction === 'apply_all') {
      await applyAllProposals(proposals, mgc, memory);
    }
    
    // 個別修正モード
    else if (batchAction === 'modify_selective') {
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
 * 提案された変更を適用
 */
async function applyProposedChanges(
  proposal: any,
  mgc: MgcService,
  dryRun?: boolean
): Promise<{ success: boolean; details?: string; error?: string }> {
  if (dryRun) {
    return { success: true, details: 'ドライランモードのため、実際の変更は行われませんでした' };
  }
  
  try {
    const suggestion = proposal.suggestion;
    
    // リスケジュールの場合
    if (suggestion.action.includes('リスケジュール')) {
      // 低優先度のイベントを特定
      const eventToReschedule = proposal.events.reduce((prev: any, curr: any) => 
        (prev.priority?.score || 0) < (curr.priority?.score || 0) ? prev : curr
      );
      
      // イベント詳細を取得してattendees情報を取得
      const eventDetails = await mgc.getEvent(eventToReschedule.id);
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
        await mgc.updateEvent(eventToReschedule.id, {
          start: newTime.meetingTimeSlot.start,
          end: newTime.meetingTimeSlot.end,
        });
        
        // 参加者に通知（コメントとして記録）
        // const message = `スケジュールコンフリクトのため、この会議を${new Date(newTime.meetingTimeSlot.start.dateTime).toLocaleString('ja-JP')}に変更しました。`;
        
        return {
          success: true,
          details: `「${eventToReschedule.subject}」を${new Date(newTime.meetingTimeSlot.start.dateTime).toLocaleString('ja-JP')}にリスケジュールしました`
        };
      } else {
        return {
          success: false,
          error: '適切な代替時間が見つかりませんでした'
        };
      }
    }
    
    // 辞退の場合
    if (suggestion.action.includes('辞退')) {
      const eventToDecline = proposal.events.reduce((prev: any, curr: any) => 
        (prev.priority?.score || 0) < (curr.priority?.score || 0) ? prev : curr
      );
      
      // イベントへの返信を更新（辞退）
      await mgc.updateEventResponse(eventToDecline.id, 'decline');
      
      // TODO: コメント付きの辞退はdeclineEventメソッドを使用
      // await mgc.declineEvent(eventToDecline.id, suggestion.reason || 'スケジュールコンフリクトのため参加できません');
      
      return {
        success: true,
        details: `「${eventToDecline.subject}」を辞退しました`
      };
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
async function modifyProposal(proposal: any): Promise<any> {
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
    case 'change_target':
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
      
    case 'specify_time':
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
      return `「${target}」を別の時間にリスケジュール`;
    case 'decline':
      return `「${target}」を辞退`;
    case 'keep':
      return `両方の会議を維持（手動調整が必要）`;
    default:
      return action;
  }
}

// 高度な提案生成（ルールベース）
function generateAdvancedSuggestion(sortedEvents: any[], action: any): { action: string; reason: string; description?: string } {
  const highPriorityEvent = sortedEvents[0];
  const lowPriorityEvent = sortedEvents[sortedEvents.length - 1];
  
  let suggestionAction = '';
  let reason = '';
  
  if (action.action === 'reschedule_lower_priority') {
    suggestionAction = `「${lowPriorityEvent.subject}」を別の時間にリスケジュール`;
    reason = `「${highPriorityEvent.subject}」の方が優先度が高いため（${highPriorityEvent.priority.level}: ${highPriorityEvent.priority.score} vs ${lowPriorityEvent.priority.level}: ${lowPriorityEvent.priority.score}）`;
  } else if (action.action === 'suggest_reschedule') {
    suggestionAction = `「${lowPriorityEvent.subject}」のリスケジュールを検討`;
    reason = `優先度の差があるため（${highPriorityEvent.priority.score - lowPriorityEvent.priority.score}ポイント差）`;
  } else {
    suggestionAction = `手動での判断が必要`;
    reason = `優先度が近いため、ビジネス判断が必要（${highPriorityEvent.priority.score} vs ${lowPriorityEvent.priority.score}）`;
  }
  
  return {
    action: suggestionAction,
    reason: reason,
    description: action.description
  };
}

/**
 * すべての提案を適用
 */
async function applyAllProposals(
  proposals: any[],
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
      if (result.success) {
        console.log(chalk.green(`  ✓ ${proposal.suggestion.action}`));
        if (result.details) {
          console.log(chalk.gray(`    ${result.details}`));
        }
        successCount++;
      } else {
        console.log(chalk.red(`  ✗ 失敗: ${result.error}`));
        errorCount++;
      }
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
  proposals: any[],
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
          if (result.success) {
            console.log(chalk.green(`  ✓ 修正を適用: ${modifiedProposal.suggestion.action}`));
            modifyCount++;
          } else {
            console.log(chalk.red(`  ✗ 失敗: ${result.error}`));
            errorCount++;
          }
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
        if (result.success) {
          console.log(chalk.green(`  ✓ 自動適用: ${proposal.suggestion.action}`));
          successCount++;
        } else {
          console.log(chalk.red(`  ✗ 失敗: ${result.error}`));
          errorCount++;
        }
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