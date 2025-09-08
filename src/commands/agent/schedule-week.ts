import { MgcService } from '../../services/mgc.js';
import { detectConflicts } from '../../utils/conflicts.js';
import { formatDateTimeRange } from '../../utils/format.js';
import chalk from 'chalk';
import inquirer from 'inquirer';

interface ScheduleWeekOptions {
  dryRun?: boolean;
  date?: string;
  json?: boolean;
  rules?: string;
}

export async function scheduleWeek(options: ScheduleWeekOptions): Promise<void> {
  const mgc = new MgcService();
  
  try {
    // 設定の読み込み（環境変数優先）
    const timezone = process.env.OUTLOOK_AGENT_TIMEZONE || process.env.TZ || 'Asia/Tokyo';
    const model = process.env.OUTLOOK_AGENT_MODEL || 'gpt-4-turbo';
    
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
    const conflicts = detectConflicts(events);
    
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
    
    // 調整案の生成（現時点では簡易的な提案）
    const proposals = [];
    for (const conflict of conflicts) {
      const proposal = {
        conflictId: `conflict-${conflicts.indexOf(conflict)}`,
        timeRange: formatDateTimeRange(conflict.startTime, conflict.endTime),
        events: conflict.events.map(e => ({
          id: e.id,
          subject: e.subject,
          organizer: e.organizer?.emailAddress.address,
          attendeesCount: e.attendees?.length || 0,
          responseStatus: e.responseStatus?.response || 'none'
        })),
        suggestion: generateSimpleSuggestion(conflict)
      };
      proposals.push(proposal);
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
    
    // 対話モード
    console.log(chalk.cyan('🤖 調整案を生成しました：'));
    console.log();
    
    for (let i = 0; i < proposals.length; i++) {
      const proposal = proposals[i];
      console.log(chalk.yellow(`[コンフリクト ${i + 1}/${proposals.length}]`));
      console.log(chalk.gray(`時間: ${proposal.timeRange}`));
      console.log();
      
      for (const event of proposal.events) {
        console.log(`  📅 ${event.subject}`);
        console.log(`     主催者: ${event.organizer || 'なし'}`);
        console.log(`     参加者: ${event.attendeesCount}名`);
        console.log(`     ステータス: ${event.responseStatus}`);
      }
      console.log();
      console.log(chalk.cyan('提案:'), proposal.suggestion.action);
      console.log(chalk.gray('理由:'), proposal.suggestion.reason);
      console.log();
      
      if (!options.dryRun) {
        const { action } = await inquirer.prompt([
          {
            type: 'list',
            name: 'action',
            message: 'この提案をどうしますか？',
            choices: [
              { name: '承認', value: 'approve' },
              { name: '修正', value: 'modify' },
              { name: 'スキップ', value: 'skip' },
              { name: '終了', value: 'exit' }
            ]
          }
        ]);
        
        if (action === 'exit') {
          console.log(chalk.yellow('調整を中断しました'));
          break;
        }
        
        if (action === 'approve') {
          // TODO: 実際の変更を適用
          console.log(chalk.green('✓ 変更を適用しました（未実装）'));
        } else if (action === 'modify') {
          console.log(chalk.yellow('手動修正機能は今後実装予定です'));
        }
      }
    }
    
    if (options.dryRun) {
      console.log();
      console.log(chalk.yellow('ドライランモードのため、実際の変更は行われませんでした'));
    }
    
    console.log();
    console.log(chalk.green('✓ スケジュール調整が完了しました！'));
    
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

// 簡易的な提案生成（後でAIに置き換え）
function generateSimpleSuggestion(conflict: any): { action: string; reason: string } {
  const events = conflict.events;
  
  // 単純なルール：参加者数が少ない方をリスケジュール
  const sortedByAttendees = [...events].sort((a, b) => 
    (a.attendees?.length || 0) - (b.attendees?.length || 0)
  );
  
  const eventToReschedule = sortedByAttendees[0];
  const keepEvent = sortedByAttendees[sortedByAttendees.length - 1];
  
  return {
    action: `「${eventToReschedule.subject}」を別の時間にリスケジュール`,
    reason: `「${keepEvent.subject}」の方が参加者が多いため（${keepEvent.attendees?.length || 0}名 vs ${eventToReschedule.attendees?.length || 0}名）`
  };
}