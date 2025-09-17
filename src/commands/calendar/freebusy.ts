import { MgcService } from '../../services/mgc.js';
import { selectUser } from '../../utils/interactive.js';
import { format, addDays } from 'date-fns';
import chalk from 'chalk';

export async function checkFreeBusy(options: { user?: string | boolean; days?: number } = {}): Promise<void> {
  const mgc = new MgcService();
  
  try {
    // ユーザー選択
    let userEmail: string | null = null;
    if (options.user === true) {
      userEmail = await selectUser();
      if (!userEmail) {
        console.log(chalk.yellow('No user selected'));
        return;
      }
    } else if (typeof options.user === 'string') {
      userEmail = options.user;
    } else {
      // ユーザー指定がない場合はインタラクティブ選択
      userEmail = await selectUser();
      if (!userEmail) {
        console.log(chalk.yellow('No user selected'));
        return;
      }
    }

    const days = options.days || 7;
    const startDate = new Date();
    const endDate = addDays(startDate, days);

    console.log(chalk.blue(`Checking free/busy for ${userEmail}...`));
    
    // Free/Busy情報を取得
    const result = await mgc.getUserFreeBusy(
      [userEmail],
      startDate.toISOString(),
      endDate.toISOString()
    );

    if (!result.value || result.value.length === 0) {
      console.log(chalk.gray('No free/busy information available'));
      return;
    }

    const schedule = result.value[0];
    console.log(chalk.bold(`\nFree/Busy for ${userEmail}:`));
    console.log(chalk.gray('─'.repeat(60)));

    // 各日の予定を表示
    for (let i = 0; i < days; i++) {
      const date = addDays(startDate, i);
      const dateStr = format(date, 'EEE, MMM d');
      console.log(chalk.bold(`\n${dateStr}:`));

      const daySchedule = schedule.scheduleItems?.filter((item: any) => {
        const itemDate = new Date(item.start.dateTime + 'Z');
        return itemDate.toDateString() === date.toDateString();
      }) || [];

      if (daySchedule.length === 0) {
        console.log(chalk.green('  All day free'));
      } else {
        daySchedule.forEach((item: any) => {
          const start = format(new Date(item.start.dateTime + 'Z'), 'HH:mm');
          const end = format(new Date(item.end.dateTime + 'Z'), 'HH:mm');
          const status = item.status === 'busy' ? chalk.red('Busy') : 
            item.status === 'tentative' ? chalk.yellow('Tentative') :
              item.status === 'oof' ? chalk.magenta('Out of Office') :
                chalk.gray('Unknown');
          console.log(`  ${start}-${end}: ${status}`);
        });
      }
    }

    console.log(chalk.gray('\n─'.repeat(60)));
  } catch (error: any) {
    if (error.message?.includes('ErrorAccessDenied')) {
      console.error(chalk.yellow('\n⚠️  Cannot access free/busy information'));
      console.error(chalk.gray('The user may need to share their calendar or enable free/busy sharing.'));
    } else {
      console.error(chalk.red('Failed to check free/busy:'), error.message || error);
    }
  }
}