import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/index.js';

/**
 * OpenAI APIを使用したAIサービス
 */
export class AIService {
  private openai: OpenAI | null = null;
  private model: string;
  
  constructor(model: string = 'gpt-4o-mini') {
    this.model = model;
    
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }
  
  /**
   * AIが利用可能かチェック
   */
  isAvailable(): boolean {
    return this.openai !== null;
  }
  
  /**
   * コンフリクト分析を実行
   */
  async analyzeConflict(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{
    success: boolean;
    analysis?: string;
    error?: string;
  }> {
    if (!this.openai) {
      return {
        success: false,
        error: 'OpenAI API key not configured'
      };
    }
    
    try {
      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ];
      
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.7,
        max_tokens: 1000,
      });
      
      const analysis = response.choices[0]?.message?.content;
      
      if (!analysis) {
        return {
          success: false,
          error: 'No response from AI'
        };
      }
      
      return {
        success: true,
        analysis
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * 構造化された分析結果を取得
   */
  async analyzeConflictStructured(
    systemPrompt: string,
    userPrompt: string
  ): Promise<{
    success: boolean;
    result?: {
      priority: {
        event1: { score: number; reason: string };
        event2: { score: number; reason: string };
      };
      recommendation: {
        action: string;
        target: string;
        reason: string;
        confidence: 'high' | 'medium' | 'low';
      };
      alternatives?: string[];
    };
    error?: string;
  }> {
    if (!this.openai) {
      return {
        success: false,
        error: 'OpenAI API key not configured'
      };
    }
    
    try {
      const structuredPrompt = `${userPrompt}

以下のJSON形式で回答してください：
{
  "priority": {
    "event1": { "score": 数値, "reason": "理由" },
    "event2": { "score": 数値, "reason": "理由" }
  },
  "recommendation": {
    "action": "reschedule|decline|keep",
    "target": "イベント名",
    "reason": "判断理由",
    "confidence": "high|medium|low"
  },
  "alternatives": ["代替案1", "代替案2"]
}`;
      
      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: structuredPrompt
        }
      ];
      
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: "json_object" }
      });
      
      const content = response.choices[0]?.message?.content;
      
      if (!content) {
        return {
          success: false,
          error: 'No response from AI'
        };
      }
      
      try {
        const result = JSON.parse(content);
        return {
          success: true,
          result
        };
      } catch (parseError) {
        // JSON解析に失敗した場合は、テキスト形式で返す
        console.warn('Failed to parse AI response as JSON, returning fallback structure:', parseError)
        return {
          success: true,
          result: {
            priority: {
              event1: { score: 50, reason: 'AI分析結果（構造化失敗）' },
              event2: { score: 50, reason: 'AI分析結果（構造化失敗）' }
            },
            recommendation: {
              action: 'keep',
              target: '',
              reason: content,
              confidence: 'low'
            }
          }
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * 複数のコンフリクトをバッチ分析
   */
  async analyzeConflictsBatch(
    conflicts: Array<{
      id: string;
      systemPrompt: string;
      userPrompt: string;
    }>
  ): Promise<Map<string, { success: boolean; analysis?: string; error?: string }>> {
    const results = new Map();
    
    // 並列処理を制限（レート制限対策）
    const batchSize = 3;
    for (let i = 0; i < conflicts.length; i += batchSize) {
      const batch = conflicts.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(c => this.analyzeConflict(c.systemPrompt, c.userPrompt))
      );
      
      batch.forEach((conflict, index) => {
        results.set(conflict.id, batchResults[index]);
      });
      
      // レート制限を避けるための遅延
      if (i + batchSize < conflicts.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }
}