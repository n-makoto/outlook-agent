# 設定ファイルについて

このディレクトリには、Outlook Agentのカスタマイズ用設定ファイルを配置します。

## セットアップ

初回使用時は、サンプルファイルをコピーして設定ファイルを作成してください：

```bash
# AI指示設定
cp prompts/ai-instructions.example.yaml prompts/ai-instructions.yaml

# スケジューリングルール設定
cp prompts/scheduling-rules.example.yaml prompts/scheduling-rules.yaml
```

## ファイル説明

### ai-instructions.yaml
AIエージェントの動作をカスタマイズする設定ファイルです。以下の設定が可能：
- コンフリクト分析の基準
- 提案生成のルール
- 特定の会議パターンの無視設定（`ignore_conflicts`）
- VIPの定義
- 避けるべき時間帯

### scheduling-rules.yaml
スケジュール調整の優先度計算ルールを定義します：
- 会議タイトルによる優先度スコア
- 参加者数による重み付け
- 主催者による重み付け
- 時間帯による調整

## プライバシー

**重要**: `ai-instructions.yaml`と`scheduling-rules.yaml`は`.gitignore`に登録されており、Gitにコミットされません。これらのファイルには個人的な会議情報が含まれる可能性があるため、共有しないようご注意ください。

## カスタマイズ例

### 特定の会議をコンフリクトとして扱わない

`ai-instructions.yaml`の`ignore_conflicts`セクションに追加：

```yaml
custom_rules:
  ignore_conflicts:
    - description: "定例会とブロック時間は両立可能"
      conditions:
        - day_of_week: "Friday"
          time: "18:00"
          event1_pattern: "Team Sync"
          event2_pattern: "ブロック"
      reason: "ブロックは柔軟な時間"
```

### 特定の会議の優先度を上げる

`scheduling-rules.yaml`の`title_patterns`に追加：

```yaml
priority_rules:
  title_patterns:
    - pattern: "重要.*顧客"
      score: 90
      description: "重要顧客との会議"
```