# Outlook Agent

Outlookカレンダーを操作するCLIツール。mgcコマンドのラッパーとして動作します。

## 必要な環境

- Node.js 18以上
- npm
- [mgc (Microsoft Graph CLI)](https://github.com/microsoftgraph/msgraph-cli)

## インストール

### グローバルインストール

```bash
npm install -g outlook-agent
```

### npxで実行（インストール不要）

```bash
npx outlook-agent --help
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