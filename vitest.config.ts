import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        'node_modules',
        'dist',
        '*.config.*',
        '**/*.test.ts',
        '**/*.d.ts',
        'src/index.ts',
        'src/cli.ts'
      ],
      // カバレッジ閾値は段階的に引き上げる予定
      // 現在: agent commandsのテストのみ実装済み
      thresholds: {
        branches: 10,
        functions: 10,
        lines: 10,
        statements: 10
      }
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': '/src'
    }
  }
});