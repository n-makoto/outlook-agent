import { jest } from '@jest/globals';

// Mock environment variables for testing
process.env.OUTLOOK_AGENT_TIMEZONE = 'Asia/Tokyo';
process.env.OUTLOOK_AGENT_MODEL = 'gpt-4o-mini';

// Suppress console output during tests unless explicitly needed
global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};