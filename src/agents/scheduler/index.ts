// Mastra integration stub - will be replaced when package compatibility is resolved

// スタブ実装
class Agent {
  constructor(_config: any) {
    // スタブ
  }
}
const openai = (model: string) => ({ model });
import { getCalendarTools } from './tools.js';
import { loadSchedulingRules } from '../../utils/rules.js';
import { loadAIInstructions, generateSystemPrompt } from '../../utils/ai-prompt.js';

// 設定の読み込み（簡易版）
const getConfig = () => ({
  timezone: process.env.OUTLOOK_AGENT_TIMEZONE || process.env.TZ || 'Asia/Tokyo',
  model: process.env.OUTLOOK_AGENT_MODEL || 'gpt-4o-mini'
});

export const createSchedulerAgent = async (rulesPath?: string, instructionsPath?: string) => {
  const config = getConfig();
  const rulesResult = await loadSchedulingRules(rulesPath);
  const aiInstructionsResult = await loadAIInstructions(instructionsPath);
  
  // カスタマイズ可能なシステムプロンプトを生成
  const systemPrompt = generateSystemPrompt(aiInstructionsResult.instructions, rulesResult.rules, config.timezone);
  
  return new Agent({
    name: 'outlook-scheduler',
    instructions: systemPrompt,
    model: openai(config.model) as any,
    tools: getCalendarTools(),
  });
};