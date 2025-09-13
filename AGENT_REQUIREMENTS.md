# Outlook Agent System 要件定義書

## 1. プロジェクト概要

### 目的
週次でOutlookカレンダーの予定を自律的に調整し、コンフリクトを解消するエージェントシステムを構築する。

### 基本方針
- **半自動実行**: エージェントが調整案を生成し、ユーザーが最終承認・微調整を行う
- **既存資産の活用**: 現在のCLIツールをMastra Agentのツールとして再利用
- **学習機能**: ユーザーの判断パターンを学習し、次回以降の提案精度を向上

## 2. システムアーキテクチャ

### 2.1 レイヤー構造
```
┌─────────────────────────────────────┐
│     Mastra Agent Layer              │
│  - Agent定義                        │
│  - ワークフロー制御                  │
│  - LLM連携 (OpenAI GPT-4)          │
└─────────────────────────────────────┘
        ↓ Tools として利用
┌─────────────────────────────────────┐
│     Tool Layer                      │
│  - OutlookツールSet                 │
│  - 優先度判定ツール                  │
│  - スケジュール最適化ツール           │
└─────────────────────────────────────┘
        ↓ 内部利用
┌─────────────────────────────────────┐
│     Service Layer (既存)            │
│  - MgcService                       │
│  - ContactsService                  │
└─────────────────────────────────────┘
        ↓
┌─────────────────────────────────────┐
│     External API                    │
│  - Microsoft Graph API (via mgc)    │
└─────────────────────────────────────┘
```

### 2.2 ディレクトリ構造（追加分）
```
outlook-agent/
├── src/
│   ├── agents/              # 新規追加
│   │   └── scheduler/
│   │       ├── index.ts     # スケジューラーエージェント本体
│   │       ├── tools.ts     # エージェント用ツール定義
│   │       └── config.ts    # エージェント設定
│   ├── commands/            # 既存
│   │   └── agent/           # 新規追加
│   │       └── schedule-week.ts
│   ├── services/            # 既存（MgcService等）
│   └── utils/               # 既存（conflicts.ts等）
├── prompts/                 # 新規追加
│   └── scheduling-rules.yaml # ユーザー定義の調整ルール
└── ~/.outlook-agent/        # ユーザーホーム（既存の連絡先キャッシュと統合）
    ├── cache/               # 既存
    ├── decisions/           # 新規：判断ログ（JSONL形式）
    └── config.json          # 新規：エージェント設定
```

### 2.3 設定管理
```typescript
// ~/.outlook-agent/config.json
{
  "timezone": "Asia/Tokyo",  // デフォルト: システムタイムゾーン
  "model": "gpt-4-turbo",    // 使用するLLMモデル
  "notificationPolicy": {
    "decline": true,          // 辞退時の通知
    "reschedule": true,       // リスケ時の通知
    "accept": false           // 承認時の通知
  },
  "dataRetention": {
    "decisionsDays": 90       // 判断ログの保持期間
  }
}
```

## 3. 機能要件

### 3.1 コア機能

#### A. 週次スケジュール分析
- 次の1週間の予定を取得
- コンフリクトの検出
- 各予定の重要度スコアリング

#### B. 優先度判定システム
- **ユーザー定義ルール（prompts/scheduling-rules.yaml）**
  ```yaml
  # スケジューリングルール設定
  version: 1.0
  
  priorities:
    critical:  # スコア: 100
      - pattern: "CEO.*1on1"
        description: "CEOとの1on1"
      - pattern: "採用.*final"
        description: "最終面接"
      - keywords: ["商談", "customer meeting", "client meeting"]
    
    high:  # スコア: 75
      - pattern: "定例.*チーム"
        description: "チーム定例会議"
      - pattern: "プロジェクト.*レビュー"
      - attendees_count: 
          min: 5
          description: "参加者5名以上"
    
    medium:  # スコア: 50
      - pattern: "1on1"
        exclude_pattern: "CEO"
      - keywords: ["打ち合わせ", "sync", "alignment"]
    
    low:  # スコア: 25
      - keywords: ["情報共有", "FYI", "optional"]
      - response_required: false
        description: "任意参加"
  
  rules:
    - if_conflict_between: ["critical", "high"]
      then: "reschedule_lower_priority"
    - if_conflict_between: ["high", "medium"]
      then: "find_alternative_slot"
    - buffer_time:
        default_minutes: 15
        between_external_meetings: 30
  ```

- **動的スコアリング要素**
  - 主催者の役職/重要度
  - 参加人数
  - 会議タイトルのキーワードマッチング
  - 定例/非定例の区別
  - 過去の出席率

#### C. 調整案生成
- リスケジュール優先のポリシー
- 空き時間の最適活用
- 移動時間/準備時間の考慮
- バッファタイムの確保

#### D. 学習・サジェスト機能
- ユーザーの承認/却下パターンを記録
- 類似ケースからの提案
- ルール更新のサジェスト

### 3.2 ユーザーインターフェース

#### 実行コマンド
```bash
# 週次調整の実行
npx outlook-agent agent schedule-week

# ドライラン（変更を適用しない）
npx outlook-agent agent schedule-week --dry-run

# 特定週の調整
npx outlook-agent agent schedule-week --date 2025-01-15

# JSON出力（他ツール連携用）
npx outlook-agent agent schedule-week --json

# ルールファイルの指定
npx outlook-agent agent schedule-week --rules ./custom-rules.yaml

# 環境変数での設定
OUTLOOK_AGENT_TIMEZONE="America/New_York" npx outlook-agent agent schedule-week
OUTLOOK_AGENT_MODEL="gpt-4o" npx outlook-agent agent schedule-week
```

#### 対話フロー
1. **分析フェーズ**
   ```
   📊 週次スケジュール分析中...
   ✓ 25件の予定を検出
   ⚠️ 3件のコンフリクトを発見
   ```

2. **提案フェーズ**
   ```
   🤖 調整案を生成しました：
   
   [コンフリクト 1/3]
   時間: 1/15(水) 14:00-15:00
   - 📅 プロジェクトレビュー (重要度: 高)
   - 📅 営業定例 (重要度: 中)
   
   提案: 営業定例を1/16(木) 15:00にリスケジュール
   理由: プロジェクトレビューの方が優先度が高く、1/16に空き時間あり
   
   [承認/修正/スキップ/詳細]?
   ```

3. **学習フェーズ**
   ```
   💡 パターンを検出しました：
   「営業定例」より「プロジェクトレビュー」を優先する傾向
   
   ルールに追加しますか？ [Y/n]
   ```

## 4. 技術仕様

### 4.1 Mastra Agent実装

```typescript
// src/agents/scheduler/index.ts
import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { getCalendarTools } from './tools';
import { loadConfig } from '../../utils/config';

const config = loadConfig(); // ~/.outlook-agent/config.json から読み込み

export const createSchedulerAgent = () => new Agent({
  name: 'outlook-scheduler',
  instructions: `
    あなたは優秀なスケジュール調整アシスタントです。
    ユーザーのカレンダーを分析し、コンフリクトを解消する最適な調整案を提案します。
    
    調整の際は以下を考慮してください：
    1. scheduling-rules.yamlに定義された優先度ルール
    2. リスケジュールを優先（辞退は最終手段）
    3. 参加者への影響を最小化
    4. 移動時間やバッファタイムの確保
    
    タイムゾーン: ${config.timezone || process.env.TZ || 'Asia/Tokyo'}
  `,
  model: openai(config.model || process.env.OUTLOOK_AGENT_MODEL || 'gpt-4-turbo'),
  tools: getCalendarTools(),
});
```

### 4.2 ツール定義

```typescript
// src/agents/scheduler/tools.ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { MgcService } from '../../services/mgc';
import { detectConflicts } from '../../utils/conflicts';
import { loadConfig } from '../../utils/config';

const config = loadConfig();

export const getWeeklySchedule = createTool({
  id: 'get-weekly-schedule',
  description: '指定週のスケジュールを取得',
  inputSchema: z.object({
    days: z.number().default(7),
  }),
  execute: async ({ input }) => {
    const mgc = new MgcService();
    // 既存のgetUpcomingEventsメソッドを使用
    return await mgc.getUpcomingEvents(input.days);
  },
});

export const detectScheduleConflicts = createTool({
  id: 'detect-conflicts',
  description: 'スケジュールのコンフリクトを検出',
  inputSchema: z.object({
    days: z.number().default(7),
  }),
  execute: async ({ input }) => {
    const mgc = new MgcService();
    const events = await mgc.getUpcomingEvents(input.days);
    // 既存のdetectConflictsユーティリティを使用
    return detectConflicts(events);
  },
});

export const updateEvent = createTool({
  id: 'update-event',
  description: 'イベントを更新（リスケジュール含む）',
  inputSchema: z.object({
    eventId: z.string(),
    updates: z.object({
      start: z.object({
        dateTime: z.string(),
        timeZone: z.string().default(config.timezone || 'Asia/Tokyo'),
      }).optional(),
      end: z.object({
        dateTime: z.string(),
        timeZone: z.string().default(config.timezone || 'Asia/Tokyo'),
      }).optional(),
    }),
    notify: z.boolean().default(config.notificationPolicy?.reschedule ?? true),
  }),
  execute: async ({ input }) => {
    const mgc = new MgcService();
    // 既存のupdateEventメソッドを使用
    return await mgc.updateEvent(input.eventId, input.updates);
  },
});

export const findAvailableSlots = createTool({
  id: 'find-available-slots',
  description: '空き時間を検索',
  inputSchema: z.object({
    attendees: z.array(z.string()),
    duration: z.number().default(30),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
  execute: async ({ input }) => {
    const mgc = new MgcService();
    // 既存のfindMeetingTimesメソッドを活用
    const data = {
      attendees: input.attendees.map(email => ({
        emailAddress: { address: email }
      })),
      timeConstraint: {
        timeslots: [{
          start: { 
            dateTime: input.startDate || new Date().toISOString(),
            timeZone: config.timezone || 'Asia/Tokyo'
          },
          end: {
            dateTime: input.endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            timeZone: config.timezone || 'Asia/Tokyo'
          }
        }]
      },
      meetingDuration: `PT${input.duration}M`,
    };
    return await mgc.findMeetingTimes(data);
  },
});
```

### 4.3 判断記録と学習

```typescript
// src/agents/scheduler/memory.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

interface Decision {
  id: string;
  timestamp: string;  // ISO 8601
  conflictHash: string;  // PIIを避けるためハッシュ化
  proposedAction: {
    type: 'reschedule' | 'decline' | 'keep';
    targetPriority: number;
  };
  userAction: {
    type: 'reschedule' | 'decline' | 'keep';
    modified: boolean;
  };
  patterns?: {
    priorityDiff: number;
    attendeesCount: number;
    isRecurring: boolean;
  };
}

export class DecisionMemory {
  private baseDir = path.join(homedir(), '.outlook-agent', 'decisions');
  
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
  
  async suggestPattern(): Promise<Pattern[]> {
    // 過去90日分の判断を分析
    const decisions = await this.loadRecentDecisions(90);
    
    // 承認率の高いパターンを抽出
    const patterns = this.analyzePatterns(decisions);
    return patterns.filter(p => p.approvalRate > 0.7);
  }
  
  private async cleanupOldData(): Promise<void> {
    const config = await loadConfig();
    const retentionDays = config.dataRetention?.decisionsDays || 90;
    
    // retentionDays以前のファイルを削除
    const files = await fs.readdir(this.baseDir);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    for (const file of files) {
      const dateStr = file.replace('.jsonl', '');
      if (new Date(dateStr) < cutoffDate) {
        await fs.unlink(path.join(this.baseDir, file));
      }
    }
  }
}
```

## 5. 実装フェーズ

### Phase 1: 基盤構築（最小実装）
- [ ] package.jsonにMastra/AI SDK依存を追加
- [ ] src/cli.tsに`agent`コマンドグループを追加
- [ ] src/commands/agent/schedule-week.tsの作成
- [ ] src/utils/config.tsで設定読み込み実装
- [ ] 環境変数（OUTLOOK_AGENT_TIMEZONE、OUTLOOK_AGENT_MODEL）のサポート

### Phase 2: コア機能実装（MVP）
- [ ] prompts/scheduling-rules.yamlのスキーマ定義とサンプル作成
- [ ] Zodによるルール検証
- [ ] 既存detectConflictsとの統合
- [ ] 優先度スコアリング関数の実装
- [ ] 最小限の提案生成（JSON出力）

### Phase 3: インタラクション（既存UIスタイル踏襲）
- [ ] inquirerベースの対話型承認フロー
- [ ] ドライラン→差分提示→承認の実装
- [ ] 実行結果のサマリー表示

### Phase 4: 学習機能（段階的実装）
- [ ] ~/.outlook-agent/decisions/へのJSONL記録
- [ ] 承認/却下の統計収集
- [ ] 簡単なパターン検出とルール提案
- [ ] PIIマスキング（subject/attendeesのハッシュ化）

## 6. 成功指標

### 定量的指標
- コンフリクト解消率: 90%以上
- ユーザー承認率: 70%以上（初回提案）
- 処理時間: 1週間分の調整を3分以内

### 定性的指標
- 提案の妥当性向上（学習により改善）
- ユーザーの手動調整時間の削減
- ルールのカスタマイズ性

## 7. リスクと対策

### リスク
1. **誤った調整による業務影響**
   - 対策: ドライラン機能、承認フロー必須

2. **API制限/レート制限**
   - 対策: バッチ処理、キャッシュ活用

3. **複雑なコンフリクトパターン**
   - 対策: 段階的な自動化、手動介入オプション

## 8. 今後の拡張可能性

- Slack/Teams通知連携
- 他のカレンダーシステム対応
- チーム全体の最適化
- 会議室予約との連携
- 優先度の機械学習モデル化