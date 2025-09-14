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
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80
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