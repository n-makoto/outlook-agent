import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { getCalendarTools } from './tools.js';

// 設定の読み込み（簡易版）
const getConfig = () => ({
  timezone: process.env.OUTLOOK_AGENT_TIMEZONE || process.env.TZ || 'Asia/Tokyo',
  model: process.env.OUTLOOK_AGENT_MODEL || 'gpt-4-turbo'
});

export const createSchedulerAgent = () => {
  const config = getConfig();
  
  return new Agent({
    name: 'outlook-scheduler',
    instructions: `
あなたは優秀なスケジュール調整アシスタントです。
ユーザーのOutlookカレンダーを分析し、コンフリクトを解消する最適な調整案を提案します。

調整の際は以下を考慮してください：
1. リスケジュールを優先（辞退は最終手段）
2. 参加者への影響を最小化
3. 会議の重要度（参加者数、主催者、タイトル）を考慮
4. 移動時間やバッファタイムの確保

タイムゾーン: ${config.timezone}

提案する際は以下の形式で出力してください：
- どの会議をどう調整するか
- その理由
- 代替案がある場合はそれも提示
`,
    model: openai(config.model),
    tools: getCalendarTools(),
  });
};