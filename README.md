# Outlook Agent

Outlookカレンダーを操作するCLIツール。mgcコマンドのラッパーとして動作します。

## 必要な環境

- Node.js 18以上
- npm
- [mgc (Microsoft Graph CLI)](https://github.com/microsoftgraph/msgraph-cli)

## インストール

### npxで実行（インストール不要・推奨）

```bash
# ヘルプを表示
npx outlook-agent --help

# 今日の予定を確認
npx outlook-agent calendar view

# 予定を作成
npx outlook-agent calendar create --interactive
```

### グローバルインストール

```bash
# インストール
npm install -g outlook-agent

# インストール後は outlook-agent コマンドが使えます
outlook-agent calendar view
```

## セットアップ

### 1. mgcのインストール

```bash
# macOS (Homebrew)
brew install microsoftgraph/tap/msgraph-cli

# または公式サイトからダウンロード
# https://github.com/microsoftgraph/msgraph-cli
```

### 2. 認証

```bash
# outlook-agentでログイン（自動的にブラウザが開きます）
npx outlook-agent login

# または直接mgcでログイン
mgc login
```

### 3. 環境確認

```bash
# 環境が正しくセットアップされているか確認
npx outlook-agent doctor
```

## 使い方

> 💡 **Tip**: 以下の例では `npx outlook-agent` を使用していますが、グローバルインストール済みの場合は `outlook-agent` に置き換えてください。

### 自分の今日の予定を確認

```bash
npx outlook-agent calendar view
```

### JSON形式で出力（LLM連携用）

```bash
# 今日の予定をJSON形式で出力
npx outlook-agent calendar view --json

# 他の人の予定をJSON形式で出力
npx outlook-agent calendar view --user email@example.com --json
```

### 他人の予定を確認（インタラクティブ選択）

```bash
npx outlook-agent calendar view --user
# 矢印キーまたは文字入力で人を選択
```

### 特定の人の予定を確認

```bash
npx outlook-agent calendar view --user email@example.com
```

### イベントを作成（インタラクティブモード）

```bash
npx outlook-agent calendar create --interactive
```

### 空き時間を探してイベントを作成

```bash
npx outlook-agent calendar create --find-slot
```

### 既存の予定をリスケジュール

```bash
# インタラクティブに予定を選んでリスケジュール
npx outlook-agent calendar reschedule

# 特定のイベントIDを指定してリスケジュール
npx outlook-agent calendar reschedule <eventId>
```

### スケジュールのコンフリクトを管理

```bash
# 次の7日間のコンフリクトを検出して管理
npx outlook-agent calendar conflicts

# 特定の期間のコンフリクトを確認
npx outlook-agent calendar conflicts --days 14
```

コンフリクト管理機能では：
- 重複している予定を自動検出
- 各予定に対して「参加」「欠席（メッセージ付き）」「リスケジュール」を選択可能
- 欠席通知は自動的に送信されます

### 保存された連絡先を表示

```bash
npx outlook-agent contacts list
```

### 連絡先の追加

```bash
# 単一の連絡先を追加
npx outlook-agent contacts add user@example.com

# 複数の連絡先をインタラクティブに追加
npx outlook-agent contacts bulk-add
```

### 連絡先のエクスポート/インポート

```bash
# JSONファイルにエクスポート
npx outlook-agent contacts export -o my-contacts.json

# CSVファイルにエクスポート
npx outlook-agent contacts export -o my-contacts.csv -f csv

# JSONファイルからインポート（既存の連絡先を置き換え）
npx outlook-agent contacts import my-contacts.json

# CSVファイルからインポート（既存の連絡先とマージ）
npx outlook-agent contacts import my-contacts.csv -m
```

## AIエージェント機能（v0.2.0〜）

### 週次スケジュール自動調整

AIを活用してスケジュールコンフリクトを自動的に分析・解決します。

```bash
# 基本的な使用方法（ドライラン）
npx outlook-agent agent schedule-week --dry-run

# 実際に変更を適用
OPENAI_API_KEY=your_key npx outlook-agent agent schedule-week

# カスタムルールを使用
npx outlook-agent agent schedule-week --rules ./my-rules.yaml

# カスタムAI指示を使用
npx outlook-agent agent schedule-week --instructions ./my-ai-instructions.yaml
```

### 主な機能

- **バッチ承認UI**: 全コンフリクトを一覧表示し、一括または選択的に処理
- **AI分析**: OpenAI APIを使用した高度な優先度判定
- **カスタマイズ可能**: YAML形式でルールとAI動作を定義
- **学習機能**: 過去の判断パターンを記憶し、提案を改善

### 設定

#### AI指示のカスタマイズ

`prompts/ai-instructions.yaml`を作成または編集：

```yaml
custom_rules:
  # 特定のコンフリクトを無視
  ignore_conflicts:
    - description: "金曜18時のToC EMよもやまとブロックは両立可能"
      conditions:
        - day_of_week: "Friday"
          time: "18:00"
          event1_pattern: "toC EM よもやま"
          event2_pattern: "ブロック"
      reason: "ブロックは参加可能な予備時間"
```

#### 環境変数

```bash
# OpenAI APIキー（AI分析を使用する場合は必須）
export OPENAI_API_KEY="sk-..."

# モデル選択（デフォルト: gpt-4o-mini）
export OUTLOOK_AGENT_MODEL="gpt-4o"  # より高度な分析が必要な場合

# タイムゾーン
export OUTLOOK_AGENT_TIMEZONE="Asia/Tokyo"
```

詳細は[AIエージェントドキュメント](docs/agent-commands.md)を参照してください。

## 開発

### ローカル開発環境のセットアップ

```bash
# リポジトリをクローン
git clone https://github.com/chaspy/outlook-agent.git
cd outlook-agent

# 依存関係をインストール
npm install

# ビルド
npm run build
```

### 開発モードで実行

```bash
npm run dev -- calendar view
```

### テスト実行

```bash
# 自分の予定
npm run dev -- calendar view

# 他人の予定（インタラクティブ）
npm run dev -- calendar view --user

# イベント作成
npm run dev -- calendar create --interactive
```

## トラブルシューティング

### "Not authenticated" エラー

```bash
npx outlook-agent login
# または
mgc login
```

### 他人の予定が見れない

他人のカレンダーを見るには、以下のいずれかが必要です：

1. **適切な権限でログイン**
   ```bash
   npx outlook-agent login
   # これにより必要な全ての権限（読み書き含む）でログインします
   ```

2. **カレンダーの共有**
   - 見たい人があなたにカレンダーを共有している必要があります
   - Outlookで相手が「カレンダーの共有」設定を行う必要があります

3. **組織の設定**
   - 組織によっては、同じ組織内のユーザーのカレンダーを見る権限が設定されている場合があります

### 連絡先グループ同期でエラー

Outlook連絡先へのアクセス権限が必要です。管理者に確認してください。

### インクリメンタルサーチが遅い

初回は過去のイベントから連絡先を取得するため時間がかかりますが、以降はキャッシュから高速に表示されます。キャッシュをクリアするには：

```bash
npx outlook-agent contacts cache --clear
```