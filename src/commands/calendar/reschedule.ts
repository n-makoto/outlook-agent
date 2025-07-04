import { MgcService } from '../../services/mgc.js';
import { format, addDays, addMinutes, differenceInMinutes } from 'date-fns';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { CalendarEvent } from '../../types/calendar.js';
import { isWorkday } from '../../utils/holidays.js';

export async function rescheduleEvent(eventId?: string): Promise<void> {
  const mgc = new MgcService();

  try {
    let selectedEvent: CalendarEvent;

    if (!eventId) {
      // イベントを選択（高速化: 7日間に限定し、Declinedは除外済み）
      console.log(chalk.cyan('Fetching your meetings...'));
      const upcomingEvents = await mgc.getUpcomingEvents(7);
      
      // 参加者がいる予定のみ表示（自分が主催者または参加者の予定）
      const eventsWithAttendees = upcomingEvents.filter(event => 
        event.attendees && event.attendees.length > 0 && 
        !event.subject.startsWith('Declined:') // 念のため件名もチェック
      );

      if (eventsWithAttendees.length === 0) {
        console.log(chalk.yellow('No meetings with attendees found in the next 7 days'));
        return;
      }

      const { selectedEventId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedEventId',
          message: 'Select an event to reschedule:',
          choices: eventsWithAttendees.map(event => {
            const startDate = new Date(event.start.dateTime);
            const attendeeCount = event.attendees?.length || 0;
            const duration = differenceInMinutes(
              new Date(event.end.dateTime),
              startDate
            );
            return {
              name: `${format(startDate, 'EEE, MMM d HH:mm')} (${duration}min) - ${event.subject} [${attendeeCount} attendees]`,
              value: event.id
            };
          }),
          pageSize: 10,
          loop: false
        }
      ]);

      selectedEvent = eventsWithAttendees.find(e => e.id === selectedEventId)!;
    } else {
      selectedEvent = await mgc.getEvent(eventId);
    }

    // イベント詳細を表示
    console.log(chalk.cyan('\nEvent details:'));
    console.log(chalk.gray(`Subject: ${selectedEvent.subject}`));
    console.log(chalk.gray(`Current time: ${format(new Date(selectedEvent.start.dateTime), 'EEE, MMM d HH:mm')} - ${format(new Date(selectedEvent.end.dateTime), 'HH:mm')}`));
    console.log(chalk.gray(`Attendees: ${selectedEvent.attendees?.map(a => a.emailAddress.address).join(', ')}`));

    // リスケジュールの確認
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do with this meeting?',
        choices: [
          { name: 'Find a new time', value: 'reschedule' },
          { name: 'Cancel this meeting', value: 'cancel' },
          { name: 'Exit without changes', value: 'exit' }
        ]
      }
    ]);

    if (action === 'exit') {
      console.log(chalk.yellow('No changes made'));
      return;
    }

    if (action === 'cancel') {
      // キャンセルメッセージを入力
      const { cancelMessage } = await inquirer.prompt([
        {
          type: 'input',
          name: 'cancelMessage',
          message: 'Enter a cancellation message (optional):',
          default: 'This meeting has been cancelled.'
        }
      ]);

      // キャンセル確認
      const { confirmCancel } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmCancel',
          message: 'Are you sure you want to cancel this meeting?',
          default: false
        }
      ]);

      if (confirmCancel) {
        try {
          console.log(chalk.cyan('Cancelling meeting...'));
          await mgc.cancelEvent(selectedEvent.id, cancelMessage);
          console.log(chalk.green('✓ Meeting cancelled successfully!'));
        } catch (error: any) {
          console.error(chalk.red('Failed to cancel meeting:'), error.message || error);
        }
      } else {
        console.log(chalk.yellow('Cancellation aborted'));
      }
      return;
    }

    // 会議時間を計算
    const duration = differenceInMinutes(
      new Date(selectedEvent.end.dateTime),
      new Date(selectedEvent.start.dateTime)
    );

    // 空き時間を探す
    console.log(chalk.cyan('Finding available time slots...'));
    
    const now = new Date();
    
    // Free/Busy APIのために現在時刻を30分単位に丸める（切り捨て）
    const alignedNow = new Date(now);
    alignedNow.setMinutes(Math.floor(alignedNow.getMinutes() / 30) * 30, 0, 0);
    
    const searchDays = 14;
    const endSearchDate = addDays(alignedNow, searchDays);
    
    // 参加者のメールアドレスを取得（自分も含める）
    const attendeeEmails = selectedEvent.attendees?.map(a => a.emailAddress.address) || [];
    const currentUser = await mgc.getCurrentUser();
    if (!attendeeEmails.includes(currentUser.mail)) {
      attendeeEmails.push(currentUser.mail);
    }
    
    console.log(chalk.gray('Checking availability...'));
    
    const startDateStr = format(now, 'yyyy-MM-dd');
    const endDateStr = format(endSearchDate, 'yyyy-MM-dd');
    
    // 並行実行で高速化
    const [myEvents, freeBusyResult] = await Promise.all([
      // 自分のカレンダーを取得
      mgc.getMyCalendarEvents(
        `${startDateStr}T00:00:00+09:00`,
        `${endDateStr}T23:59:59+09:00`
      ).catch(() => {
        console.warn(chalk.yellow('Could not fetch your calendar events'));
        return [] as CalendarEvent[];
      }),
      // 参加者のFree/Busyを取得
      mgc.getUserFreeBusy(
        attendeeEmails,
        alignedNow.toISOString(),
        endSearchDate.toISOString()
      )
    ]);

    
    // 候補を探す
    const candidates: Array<{ date: Date; start: Date; end: Date }> = [];
    
    for (let i = 0; i < searchDays; i++) {
      const date = addDays(now, i);
      const dateStr = format(date, 'yyyy-MM-dd');
      
      // 週末・祝日をスキップ
      if (!isWorkday(date)) {
        continue;
      }
      
      // 営業時間の設定（9:00-19:00）
      let searchStartTime = new Date(`${dateStr}T09:00:00+09:00`);
      const searchEndTime = new Date(`${dateStr}T19:00:00+09:00`);
      
      // 今日の場合は現在時刻の30分後から検索
      if (i === 0) {
        const minStartTime = addMinutes(now, 30);
        if (minStartTime > searchStartTime) {
          searchStartTime = minStartTime;
        }
      }

      // 30分単位で空き時間をチェック
      let currentTime = searchStartTime;
      while (currentTime < searchEndTime && addMinutes(currentTime, duration) <= searchEndTime) {
        const slotEnd = addMinutes(currentTime, duration);
        
        // 元の予定と同じ時間帯はスキップ
        const originalStart = new Date(selectedEvent.start.dateTime);
        if (currentTime.getTime() === originalStart.getTime()) {
          currentTime = addMinutes(currentTime, 30);
          continue;
        }
        
        // 全員が空いているかチェック
        let allAvailable = true;
        
        // 自分のカレンダーをチェック
        for (const event of myEvents) {
          // 元の予定はスキップ
          if (event.id === selectedEvent.id) continue;
          
          // イベントの時刻をそのまま使用
          // タイムゾーン処理
          // timeZoneが指定されている場合はそのまま、ない場合はUTCとして解釈
          const startDateTime = event.start.timeZone === 'Asia/Tokyo' 
            ? event.start.dateTime + '+09:00'
            : event.start.dateTime + 'Z';
          const endDateTime = event.end.timeZone === 'Asia/Tokyo'
            ? event.end.dateTime + '+09:00'
            : event.end.dateTime + 'Z';
            
          const eventStart = new Date(startDateTime);
          const eventEnd = new Date(endDateTime);
          
          // 同じ日付のイベントのみチェック
          if (eventStart.toDateString() !== currentTime.toDateString() &&
              eventEnd.toDateString() !== currentTime.toDateString()) {
            continue;
          }
          
          // 終日予定のチェック（showAsがfreeでない場合のみ）
          if (event.isAllDay && eventStart.toDateString() === currentTime.toDateString()) {
            if (event.showAs !== 'free') {
              allAvailable = false;
              break;
            }
          }
          
          // 時間帯の重複チェック（showAsがfreeの場合はスキップ）
          if ((currentTime >= eventStart && currentTime < eventEnd) ||
              (slotEnd > eventStart && slotEnd <= eventEnd) ||
              (currentTime <= eventStart && slotEnd >= eventEnd)) {
            if (event.showAs !== 'free') {
              allAvailable = false;
              break;
            }
          }
        }
        
        // 参加者のFree/Busyをチェック
        if (allAvailable) {
          const schedules = freeBusyResult.value || [];
          
          for (const schedule of schedules) {
            const busyTimes = schedule.scheduleItems || [];
            
            for (const busy of busyTimes) {
              // Free/Busy APIはUTCで返すので、タイムゾーンを考慮
              const busyStart = new Date(busy.start.dateTime + 'Z');
              const busyEnd = new Date(busy.end.dateTime + 'Z');
              
              // status が free の場合はスキップ（空き時間として扱う）
              if (busy.status === 'free') {
                continue;
              }
              
              // 時間帯重複チェック
              if ((currentTime >= busyStart && currentTime < busyEnd) ||
                  (slotEnd > busyStart && slotEnd <= busyEnd) ||
                  (currentTime <= busyStart && slotEnd >= busyEnd)) {
                allAvailable = false;
                break;
              }
            }
            if (!allAvailable) break;
          }
        }
        
        if (allAvailable) {
          candidates.push({
            date: date,
            start: currentTime,
            end: slotEnd
          });
        }
        
        // 30分進める
        currentTime = addMinutes(currentTime, 30);
      }
    }

    if (candidates.length === 0) {
      console.log(chalk.yellow(`No available time slots found in the next ${searchDays} days (weekdays only)`));
      return;
    }

    // 候補を表示して選択（最大20個表示）
    const sortedCandidates = candidates.sort((a, b) => a.start.getTime() - b.start.getTime());
    const { selectedSlot } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedSlot',
        message: 'Select a new time slot:',
        choices: sortedCandidates.slice(0, 20).map((candidate, index) => ({
          name: `${format(candidate.date, 'EEE, MMM d')} ${format(candidate.start, 'HH:mm')}-${format(candidate.end, 'HH:mm')}`,
          value: index
        })),
        pageSize: 10,
        loop: false
      }
    ]);

    const selected = sortedCandidates[selectedSlot];

    // 更新内容を確認
    console.log(chalk.cyan('\nReschedule summary:'));
    console.log(chalk.gray(`From: ${format(new Date(selectedEvent.start.dateTime), 'EEE, MMM d HH:mm')} - ${format(new Date(selectedEvent.end.dateTime), 'HH:mm')}`));
    console.log(chalk.gray(`To: ${format(selected.start, 'EEE, MMM d HH:mm')} - ${format(selected.end, 'HH:mm')}`));

    const { confirmUpdate } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmUpdate',
        message: 'Confirm rescheduling?',
        default: true
      }
    ]);

    if (!confirmUpdate) {
      console.log(chalk.yellow('Reschedule cancelled'));
      return;
    }

    // イベントを更新
    console.log(chalk.cyan('Updating event...'));
    await mgc.updateEvent(selectedEvent.id, {
      start: {
        dateTime: selected.start.toISOString(),
        timeZone: 'Asia/Tokyo'
      },
      end: {
        dateTime: selected.end.toISOString(),
        timeZone: 'Asia/Tokyo'
      }
    });

    console.log(chalk.green('✓ Event rescheduled successfully!'));
    console.log(chalk.gray('Meeting invitations will be sent to all attendees.'));
  } catch (error: any) {
    console.error(chalk.red('Failed to reschedule event:'), error.message || error);
    process.exit(1);
  }
}