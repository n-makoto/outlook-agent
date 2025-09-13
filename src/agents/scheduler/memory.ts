import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import * as crypto from 'crypto';
import { loadConfig } from '../../utils/config.js';

/**
 * 判断記録のインターフェース
 */
interface Decision {
  id: string;
  timestamp: string;  // ISO 8601
  conflictHash: string;  // PIIを避けるためハッシュ化
  proposedAction: {
    type: 'reschedule' | 'decline' | 'keep';
    targetPriority: number;
    priorityDiff: number;
  };
  userAction: {
    type: 'approve' | 'modify' | 'skip';
    finalAction?: 'reschedule' | 'decline' | 'keep';
    modified: boolean;
  };
  patterns?: {
    priorityDiff: number;
    attendeesCount: number;
    isRecurring: boolean;
    timeOfDay: string;  // morning, afternoon, evening
    dayOfWeek: number;  // 0-6
  };
  feedback?: {
    wasSuccessful: boolean;
    userComment?: string;
  };
}

/**
 * 学習パターンのインターフェース
 */
interface Pattern {
  id: string;
  description: string;
  conditions: {
    minPriorityDiff?: number;
    maxPriorityDiff?: number;
    minAttendees?: number;
    timeOfDay?: string;
    isRecurring?: boolean;
  };
  suggestedAction: string;
  approvalRate: number;
  sampleCount: number;
  lastUpdated: string;
}

/**
 * 判断記録と学習機能を管理するクラス
 */
export class DecisionMemory {
  private baseDir = path.join(homedir(), '.outlook-agent', 'decisions');
  
  /**
   * 判断を記録
   */
  async recordDecision(decision: Decision): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    
    // JSONL形式で追記（日付ごとのファイル）
    const today = new Date().toISOString().split('T')[0];
    const filePath = path.join(this.baseDir, `${today}.jsonl`);
    
    await fs.appendFile(
      filePath,
      JSON.stringify(decision) + '\n',
      'utf-8'
    );
    
    // 古いデータのクリーンアップ
    await this.cleanupOldData();
  }
  
  /**
   * コンフリクトから判断記録を作成
   */
  createDecisionRecord(
    conflict: any,
    proposal: any,
    userAction: 'approve' | 'modify' | 'skip',
    finalAction?: any
  ): Decision {
    const now = new Date();
    const hour = now.getHours();
    let timeOfDay = 'morning';
    if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
    else if (hour >= 17) timeOfDay = 'evening';
    
    // PIIを避けるためにハッシュ化
    const conflictData = JSON.stringify({
      time: conflict.timeRange,
      eventCount: conflict.events.length,
      priorities: conflict.events.map((e: any) => e.priority?.score || 0)
    });
    const conflictHash = crypto.createHash('sha256').update(conflictData).digest('hex');
    
    const highPriorityEvent = proposal.events.reduce((prev: any, curr: any) => 
      (prev.priority?.score || 0) > (curr.priority?.score || 0) ? prev : curr
    );
    const lowPriorityEvent = proposal.events.reduce((prev: any, curr: any) => 
      (prev.priority?.score || 0) < (curr.priority?.score || 0) ? prev : curr
    );
    
    return {
      id: crypto.randomUUID(),
      timestamp: now.toISOString(),
      conflictHash,
      proposedAction: {
        type: this.extractActionType(proposal.suggestion.action),
        targetPriority: lowPriorityEvent.priority?.score || 0,
        priorityDiff: (highPriorityEvent.priority?.score || 0) - (lowPriorityEvent.priority?.score || 0)
      },
      userAction: {
        type: userAction,
        finalAction: finalAction ? this.extractActionType(finalAction) : undefined,
        modified: userAction === 'modify'
      },
      patterns: {
        priorityDiff: (highPriorityEvent.priority?.score || 0) - (lowPriorityEvent.priority?.score || 0),
        attendeesCount: proposal.events.reduce((sum: number, e: any) => sum + (e.attendeesCount || 0), 0),
        isRecurring: false,  // TODO: 定例会議の判定を実装
        timeOfDay,
        dayOfWeek: now.getDay()
      }
    };
  }
  
  /**
   * アクションタイプを抽出
   */
  private extractActionType(actionText: string): 'reschedule' | 'decline' | 'keep' {
    if (actionText.includes('リスケジュール') || actionText.includes('reschedule')) {
      return 'reschedule';
    } else if (actionText.includes('辞退') || actionText.includes('decline')) {
      return 'decline';
    }
    return 'keep';
  }
  
  /**
   * パターンを提案
   */
  async suggestPattern(): Promise<Pattern[]> {
    // 過去90日分の判断を分析
    const decisions = await this.loadRecentDecisions(90);
    
    if (decisions.length < 5) {
      return [];  // 十分なデータがない
    }
    
    // 承認率の高いパターンを抽出
    const patterns = this.analyzePatterns(decisions);
    return patterns.filter(p => p.approvalRate > 0.7 && p.sampleCount >= 5);
  }
  
  /**
   * 最近の判断を読み込み
   */
  private async loadRecentDecisions(days: number): Promise<Decision[]> {
    const decisions: Decision[] = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    try {
      const files = await fs.readdir(this.baseDir);
      
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        
        const dateStr = file.replace('.jsonl', '');
        const fileDate = new Date(dateStr);
        
        if (fileDate >= cutoffDate) {
          const filePath = path.join(this.baseDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.trim().split('\n');
          
          for (const line of lines) {
            if (line) {
              try {
                decisions.push(JSON.parse(line));
              } catch (e) {
                // 不正な行はスキップ
              }
            }
          }
        }
      }
    } catch (error) {
      // ディレクトリが存在しない場合は空配列を返す
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    
    return decisions;
  }
  
  /**
   * パターンを分析
   */
  private analyzePatterns(decisions: Decision[]): Pattern[] {
    const patterns: Pattern[] = [];
    
    // 優先度差によるパターン
    const priorityRanges = [
      { min: 50, max: 100, label: '大きな優先度差（50以上）' },
      { min: 25, max: 50, label: '中程度の優先度差（25-50）' },
      { min: 0, max: 25, label: '小さな優先度差（25未満）' }
    ];
    
    for (const range of priorityRanges) {
      const relevantDecisions = decisions.filter(d => 
        d.patterns && 
        d.patterns.priorityDiff >= range.min && 
        d.patterns.priorityDiff < range.max
      );
      
      if (relevantDecisions.length >= 3) {
        const approvals = relevantDecisions.filter(d => d.userAction.type === 'approve');
        const approvalRate = approvals.length / relevantDecisions.length;
        
        // 最も多く承認されたアクションを特定
        const actionCounts: Record<string, number> = {};
        approvals.forEach(d => {
          const action = d.proposedAction.type;
          actionCounts[action] = (actionCounts[action] || 0) + 1;
        });
        
        const mostCommonAction = Object.entries(actionCounts)
          .sort(([, a], [, b]) => b - a)[0];
        
        if (mostCommonAction) {
          patterns.push({
            id: crypto.randomUUID(),
            description: range.label,
            conditions: {
              minPriorityDiff: range.min,
              maxPriorityDiff: range.max
            },
            suggestedAction: mostCommonAction[0],
            approvalRate,
            sampleCount: relevantDecisions.length,
            lastUpdated: new Date().toISOString()
          });
        }
      }
    }
    
    // 時間帯によるパターン
    const timeOfDayGroups = ['morning', 'afternoon', 'evening'];
    for (const timeOfDay of timeOfDayGroups) {
      const relevantDecisions = decisions.filter(d => 
        d.patterns?.timeOfDay === timeOfDay
      );
      
      if (relevantDecisions.length >= 3) {
        const approvals = relevantDecisions.filter(d => d.userAction.type === 'approve');
        const approvalRate = approvals.length / relevantDecisions.length;
        
        if (approvalRate > 0.7) {
          patterns.push({
            id: crypto.randomUUID(),
            description: `${timeOfDay}の会議`,
            conditions: {
              timeOfDay
            },
            suggestedAction: 'context_dependent',
            approvalRate,
            sampleCount: relevantDecisions.length,
            lastUpdated: new Date().toISOString()
          });
        }
      }
    }
    
    return patterns;
  }
  
  /**
   * フィードバックを記録
   */
  async recordFeedback(
    decisionId: string,
    wasSuccessful: boolean,
    userComment?: string
  ): Promise<void> {
    // 最近の判断から該当するものを検索
    const decisions = await this.loadRecentDecisions(7);
    const decision = decisions.find(d => d.id === decisionId);
    
    if (decision) {
      decision.feedback = {
        wasSuccessful,
        userComment
      };
      
      // 更新された判断を記録
      await this.recordDecision(decision);
    }
  }
  
  /**
   * 古いデータのクリーンアップ
   */
  private async cleanupOldData(): Promise<void> {
    const config = await loadConfig();
    const retentionDays = config.dataRetention?.decisionsDays || 90;
    
    // retentionDays以前のファイルを削除
    try {
      const files = await fs.readdir(this.baseDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        
        const dateStr = file.replace('.jsonl', '');
        if (new Date(dateStr) < cutoffDate) {
          await fs.unlink(path.join(this.baseDir, file));
        }
      }
    } catch (error) {
      // ディレクトリが存在しない場合は無視
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
  }
  
  /**
   * 統計情報を取得
   */
  async getStatistics(): Promise<{
    totalDecisions: number;
    approvalRate: number;
    modificationRate: number;
    skipRate: number;
    topPatterns: Pattern[];
  }> {
    const decisions = await this.loadRecentDecisions(30);
    
    if (decisions.length === 0) {
      return {
        totalDecisions: 0,
        approvalRate: 0,
        modificationRate: 0,
        skipRate: 0,
        topPatterns: []
      };
    }
    
    const approvals = decisions.filter(d => d.userAction.type === 'approve').length;
    const modifications = decisions.filter(d => d.userAction.type === 'modify').length;
    const skips = decisions.filter(d => d.userAction.type === 'skip').length;
    
    const patterns = await this.suggestPattern();
    
    return {
      totalDecisions: decisions.length,
      approvalRate: approvals / decisions.length,
      modificationRate: modifications / decisions.length,
      skipRate: skips / decisions.length,
      topPatterns: patterns.slice(0, 3)
    };
  }
}