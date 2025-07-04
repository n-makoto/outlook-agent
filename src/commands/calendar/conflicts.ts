import { MgcService } from '../../services/mgc.js';
import { detectConflicts, formatConflictSummary } from '../../utils/conflicts.js';
import { formatDateTimeRange } from '../../utils/format.js';
import { ConflictResolution } from '../../types/conflict.js';
import chalk from 'chalk';
import inquirer from 'inquirer';

export async function manageConflicts(days: number = 7): Promise<void> {
  const mgc = new MgcService();

  try {
    console.log(chalk.cyan(`Checking for scheduling conflicts in the next ${days} days...`));
    
    // 予定を取得
    const events = await mgc.getUpcomingEvents(days);
    
    // コンフリクトを検出
    const conflicts = detectConflicts(events);
    
    if (conflicts.length === 0) {
      console.log(chalk.green('✓ No scheduling conflicts found!'));
      return;
    }
    
    console.log(chalk.yellow(`\nFound ${conflicts.length} conflict(s):\n`));
    
    // 各コンフリクトを処理
    for (let i = 0; i < conflicts.length; i++) {
      const conflict = conflicts[i];
      console.log(chalk.yellow(`\nConflict ${i + 1}/${conflicts.length}:`));
      console.log(chalk.gray(`Time: ${formatDateTimeRange(conflict.startTime, conflict.endTime)}`));
      console.log(chalk.gray('Conflicting events:'));
      console.log(formatConflictSummary(conflict));
      
      const { action } = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'How would you like to handle this conflict?',
          choices: [
            { name: 'Select which events to attend/decline', value: 'resolve' },
            { name: 'Skip this conflict', value: 'skip' },
            { name: 'Exit', value: 'exit' }
          ]
        }
      ]);
      
      if (action === 'exit') {
        break;
      }
      
      if (action === 'skip') {
        continue;
      }
      
      // 各イベントに対してアクションを選択
      const resolutions: ConflictResolution[] = [];
      
      for (const event of conflict.events) {
        console.log(chalk.cyan(`\nEvent: ${event.subject}`));
        console.log(chalk.white(`Organizer: ${event.organizer?.emailAddress.name || event.organizer?.emailAddress.address || 'Unknown'}`));
        console.log(chalk.white(`Current status: ${event.responseStatus?.response || 'none'}`));
        if (event.responseRequested === false) {
          console.log(chalk.white(`Response required: No (RSVP not requested)`));
        }
        
        // 自分が主催者かどうかチェック
        const isOrganizer = event.responseStatus?.response === 'organizer';
        
        const choices = [
          { name: 'Attend this event', value: 'attend' },
          { name: 'Keep current status', value: 'keep' }
        ];
        
        // 主催者でない場合のみ辞退を追加、主催者の場合はキャンセルを追加
        if (!isOrganizer) {
          choices.splice(1, 0, 
            { name: 'Decline with message', value: 'decline' },
            { name: 'Reschedule this event', value: 'reschedule' }
          );
        } else {
          console.log(chalk.yellow('(You are the organizer)'));
          choices.splice(1, 0,
            { name: 'Cancel this event', value: 'cancel' },
            { name: 'Reschedule this event', value: 'reschedule' }
          );
        }
        
        const { eventAction } = await inquirer.prompt([
          {
            type: 'list',
            name: 'eventAction',
            message: 'What would you like to do with this event?',
            choices
          }
        ]);
        
        if (eventAction === 'keep') {
          continue;
        }
        
        if (eventAction === 'decline') {
          const { declineMessage } = await inquirer.prompt([
            {
              type: 'input',
              name: 'declineMessage',
              message: 'Enter a message for declining (optional):',
              default: 'I have a scheduling conflict at this time.'
            }
          ]);
          
          resolutions.push({
            eventId: event.id,
            action: 'decline',
            declineMessage
          });
        } else if (eventAction === 'cancel') {
          const { cancelMessage } = await inquirer.prompt([
            {
              type: 'input',
              name: 'cancelMessage',
              message: 'Enter a message for cancelling (optional):',
              default: 'This meeting has been cancelled due to a scheduling conflict.'
            }
          ]);
          
          resolutions.push({
            eventId: event.id,
            action: 'decline', // 内部的にはdeclineとして処理し、後でキャンセルと判定
            declineMessage: cancelMessage
          });
        } else {
          resolutions.push({
            eventId: event.id,
            action: eventAction as 'attend' | 'reschedule'
          });
        }
      }
      
      // アクションの確認
      if (resolutions.length > 0) {
        console.log(chalk.cyan('\nPlanned actions:'));
        for (const resolution of resolutions) {
          const event = conflict.events.find(e => e.id === resolution.eventId);
          const isOrganizer = event?.responseStatus?.response === 'organizer';
          
          if (resolution.action === 'decline') {
            if (isOrganizer) {
              console.log(chalk.red(`- Cancel: ${event?.subject}`));
            } else {
              console.log(chalk.red(`- Decline: ${event?.subject}`));
            }
            if (resolution.declineMessage) {
              console.log(chalk.gray(`  Message: ${resolution.declineMessage}`));
            }
          } else if (resolution.action === 'reschedule') {
            console.log(chalk.yellow(`- Reschedule: ${event?.subject}`));
          } else {
            console.log(chalk.green(`- Attend: ${event?.subject}`));
          }
        }
        
        const { confirmActions } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmActions',
            message: 'Execute these actions?',
            default: true
          }
        ]);
        
        if (confirmActions) {
          // アクションを実行
          for (const resolution of resolutions) {
            const event = conflict.events.find(e => e.id === resolution.eventId);
            const isOrganizer = event?.responseStatus?.response === 'organizer';
            
            if (resolution.action === 'attend') {
              // Attendを選択した場合、acceptedにする
              if (!isOrganizer && event?.responseStatus?.response !== 'accepted') {
                console.log(chalk.cyan(`Accepting: ${event?.subject}...`));
                try {
                  await mgc.updateEventResponse(resolution.eventId, 'accept');
                  console.log(chalk.green('✓ Accepted'));
                } catch (error: any) {
                  console.log(chalk.red('Failed to accept:'), error.message);
                }
              }
            } else if (resolution.action === 'decline') {
              if (isOrganizer) {
                // 主催者の場合はキャンセル
                console.log(chalk.cyan(`Cancelling: ${event?.subject}...`));
                try {
                  await mgc.cancelEvent(resolution.eventId, resolution.declineMessage);
                  console.log(chalk.green('✓ Event cancelled'));
                } catch (error: any) {
                  console.log(chalk.red('Failed to cancel event:'), error.message);
                }
              } else {
                // 参加者の場合は辞退
                console.log(chalk.cyan(`Processing: ${event?.subject}...`));
                
                // 返信が必要かチェック
                if (event?.responseRequested === false) {
                  console.log(chalk.yellow('This event does not require a response.'));
                  console.log(chalk.gray('Updating your status to "declined" without sending notification...'));
                  try {
                    await mgc.updateEventResponse(resolution.eventId, 'decline');
                    console.log(chalk.green('✓ Your status updated to "declined"'));
                  } catch (error: any) {
                    console.log(chalk.red('Failed to update status:'), error.message);
                  }
                } else {
                  try {
                    await mgc.declineEvent(resolution.eventId, resolution.declineMessage);
                    console.log(chalk.green('✓ Declined and notification sent'));
                  } catch (error: any) {
                    if (error.message?.includes('hasn\'t requested a response')) {
                      console.log(chalk.yellow('Cannot send decline notification - response not requested by organizer'));
                      console.log(chalk.gray('Updating your status to "declined" without sending notification...'));
                      try {
                        await mgc.updateEventResponse(resolution.eventId, 'decline');
                        console.log(chalk.green('✓ Your status updated to "declined"'));
                      } catch (updateError: any) {
                        console.log(chalk.red('Failed to update status:'), updateError.message);
                      }
                    } else {
                      throw error;
                    }
                  }
                }
              }
            } else if (resolution.action === 'reschedule') {
              console.log(chalk.cyan(`\nRescheduling: ${event?.subject}`));
              // rescheduleEventをインポートして使用
              const { rescheduleEvent } = await import('./reschedule.js');
              await rescheduleEvent(resolution.eventId);
            }
            // 'attend'の場合は特に何もしない（現状維持）
          }
        }
      }
    }
    
    console.log(chalk.green('\n✓ Conflict management completed!'));
  } catch (error: any) {
    console.error(chalk.red('Failed to manage conflicts:'), error.message || error);
    process.exit(1);
  }
}