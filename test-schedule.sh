#!/bin/bash

echo "🧪 Schedule-week リファクタリングテスト"
echo "======================================"

# 1. ビルドチェック
echo "1️⃣ ビルド確認..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ ビルドに失敗しました"
    exit 1
fi
echo "✅ ビルド成功"
echo

# 2. ユニットテスト
echo "2️⃣ ユニットテスト実行..."
npm test
if [ $? -ne 0 ]; then
    echo "❌ テストに失敗しました"
    exit 1
fi
echo "✅ テスト成功"
echo

# 3. TypeScript型チェック
echo "3️⃣ 型チェック..."
npx tsc --noEmit
if [ $? -ne 0 ]; then
    echo "❌ 型チェックに失敗しました"
    exit 1
fi
echo "✅ 型チェック成功"
echo

# 4. ドライランでの動作確認
echo "4️⃣ ドライランモードでの動作確認..."
npm run dev agent schedule-week --dry-run --json > /tmp/schedule-test.json
if [ $? -eq 0 ]; then
    echo "✅ ドライラン成功"
    echo "   出力: /tmp/schedule-test.json"
else
    echo "⚠️  ドライラン実行時にエラー（認証が必要な可能性があります）"
fi
echo

# 5. カバレッジレポート
echo "5️⃣ テストカバレッジ確認..."
npm run test:coverage -- --run 2>/dev/null | grep -A 5 "Coverage summary"
echo

echo "======================================"
echo "✨ テスト完了！"
echo
echo "次のステップ:"
echo "  - 実際のカレンダーでテスト: outlook-agent agent schedule-week"
echo "  - PR確認: https://github.com/chaspy/outlook-agent/pull/12"
echo "  - SonarCloud分析: get-sonar-feedback pr 12"