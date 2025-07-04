# リリース手順

## 自動リリース（推奨）

タグをプッシュすると自動的にNPMに公開されます。

### 1. NPMトークンの設定（初回のみ）

1. NPMにログインして[アクセストークンを作成](https://www.npmjs.com/settings/~/tokens)
   - **"Generate New Token"** → **"Granular Access Token"** を選択
   - Token name: `outlook-agent-github-actions`
   - Expiration: 90 days（推奨）
   - Packages and scopes:
     - Select packages: `outlook-agent`
     - Permissions: `Read and write`
   - **Generate token** をクリックしてトークンをコピー

2. GitHubリポジトリの Settings > Secrets and variables > Actions で `NPM_TOKEN` を追加
   - Name: `NPM_TOKEN`
   - Secret: コピーしたトークン

### 2. リリース手順

```bash
# 1. 最新の変更を取得
git pull origin main

# 2. バージョンを更新（package.jsonが更新され、gitタグも作成される）
# パッチリリース: バグ修正など (0.1.0 -> 0.1.1)
npm version patch

# マイナーリリース: 新機能追加など (0.1.0 -> 0.2.0)
npm version minor

# メジャーリリース: 破壊的変更など (0.1.0 -> 1.0.0)
npm version major

# 3. 変更をプッシュ（mainブランチとタグの両方）
git push origin main --tags
```

#### バージョン番号の決め方（セマンティックバージョニング）

- **パッチ (x.x.X)**: バグ修正、ドキュメント修正など後方互換性のある修正
- **マイナー (x.X.x)**: 新機能追加など後方互換性のある変更
- **メジャー (X.x.x)**: 破壊的変更、APIの変更など後方互換性のない変更

例:
```bash
# バグ修正をリリース
npm version patch -m "Fix timezone handling bug"

# 新機能を追加
npm version minor -m "Add conflict management feature"

# 破壊的変更
npm version major -m "Change CLI interface"
```

### 3. リリースの確認

- GitHub Actions: https://github.com/chaspy/outlook-agent/actions
- NPMパッケージ: https://www.npmjs.com/package/outlook-agent
- GitHubリリース: https://github.com/chaspy/outlook-agent/releases

## 手動リリース（緊急時のみ）

```bash
# 1. ビルド
npm run build

# 2. NPMに公開
npm publish
```

## リリースチェックリスト

- [ ] 全ての変更がコミットされている
- [ ] テストが通っている
- [ ] README.mdが最新
- [ ] CHANGELOGを更新（オプション）