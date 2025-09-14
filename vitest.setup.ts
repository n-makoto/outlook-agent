import { vi } from 'vitest';

// Mock environment variables for testing
process.env.OUTLOOK_AGENT_TIMEZONE = 'Asia/Tokyo';
process.env.OUTLOOK_AGENT_MODEL = 'gpt-4o-mini';

// Suppress console output during tests unless explicitly needed
global.console = {
  ...console,
  log: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
};