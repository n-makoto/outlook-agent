# リリース手順

## 自動リリース（推奨）

タグをプッシュすると自動的にNPMに公開されます。

### 1. NPMトークンの設定（初回のみ）

1. NPMにログインして[アクセストークンを作成](https://www.npmjs.com/settings/~/tokens)
   - Type: `Automation` を選択
   - トークンをコピー

2. GitHubリポジトリの Settings > Secrets and variables > Actions で `NPM_TOKEN` を追加
   - Name: `NPM_TOKEN`
   - Value: コピーしたトークン

### 2. リリース手順

```bash
# 1. バージョンを更新（package.jsonが更新され、gitタグも作成される）
npm version patch  # パッチリリース (0.1.0 -> 0.1.1)
npm version minor  # マイナーリリース (0.1.0 -> 0.2.0)
npm version major  # メジャーリリース (0.1.0 -> 1.0.0)

# 2. タグをプッシュ（これによりGitHub Actionsが起動）
git push origin main --tags
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