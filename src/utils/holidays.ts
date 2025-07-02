import { format } from 'date-fns';

// 日本の祝日（2025年）
// 実際の運用では、外部APIやカレンダーから取得することを推奨
const japaneseHolidays2025 = [
  '2025-01-01', // 元日
  '2025-01-13', // 成人の日
  '2025-02-11', // 建国記念の日
  '2025-02-23', // 天皇誕生日
  '2025-02-24', // 振替休日
  '2025-03-20', // 春分の日
  '2025-04-29', // 昭和の日
  '2025-05-03', // 憲法記念日
  '2025-05-04', // みどりの日
  '2025-05-05', // こどもの日
  '2025-05-06', // 振替休日
  '2025-07-21', // 海の日
  '2025-08-11', // 山の日
  '2025-09-15', // 敬老の日
  '2025-09-23', // 秋分の日
  '2025-10-13', // スポーツの日
  '2025-11-03', // 文化の日
  '2025-11-23', // 勤労感謝の日
  '2025-11-24', // 振替休日
];

export function isHoliday(date: Date): boolean {
  const dateStr = format(date, 'yyyy-MM-dd');
  return japaneseHolidays2025.includes(dateStr);
}

export function isWorkday(date: Date): boolean {
  const dayOfWeek = date.getDay();
  // 週末チェック（0: 日曜日, 6: 土曜日）
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }
  // 祝日チェック
  if (isHoliday(date)) {
    return false;
  }
  return true;
}