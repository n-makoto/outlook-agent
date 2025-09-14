import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AIService } from './ai.js';

// Mock OpenAI
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn(() => ({
      chat: {
        completions: {
          create: mockCreate
        }
      }
    })),
    mockCreate // Export for test access
  };
});

describe('AIService', () => {
  let aiService: AIService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-api-key';
    aiService = new AIService('gpt-4o-mini');
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  describe('constructor', () => {
    it('should initialize with default model', () => {
      const service = new AIService();
      expect(service.isAvailable()).toBe(true);
    });

    it('should initialize with custom model', () => {
      const service = new AIService('gpt-4');
      expect(service.isAvailable()).toBe(true);
    });

    it('should not initialize OpenAI without API key', () => {
      delete process.env.OPENAI_API_KEY;
      const service = new AIService();
      expect(service.isAvailable()).toBe(false);
    });
  });

  describe('isAvailable', () => {
    it('should return true when OpenAI is initialized', () => {
      expect(aiService.isAvailable()).toBe(true);
    });

    it('should return false when OpenAI is not initialized', () => {
      delete process.env.OPENAI_API_KEY;
      const service = new AIService();
      expect(service.isAvailable()).toBe(false);
    });
  });

  describe('analyzeConflict', () => {
    it('should successfully analyze conflict', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'This is the AI analysis result'
          }
        }]
      };

      const OpenAI = (await import('openai')).default;
      const mockInstance = new OpenAI({ apiKey: 'test' });
      vi.mocked(mockInstance.chat.completions.create).mockResolvedValue(mockResponse as any);

      const service = new AIService();
      const result = await service.analyzeConflict(
        'System prompt',
        'User prompt'
      );

      expect(result).toEqual({
        success: true,
        analysis: 'This is the AI analysis result'
      });
    });

    it('should handle missing API key', async () => {
      delete process.env.OPENAI_API_KEY;
      const service = new AIService();
      
      const result = await service.analyzeConflict(
        'System prompt',
        'User prompt'
      );

      expect(result).toEqual({
        success: false,
        error: 'OpenAI API key not configured'
      });
    });

    it('should handle empty response from AI', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: null
          }
        }]
      };

      const OpenAI = (await import('openai')).default;
      const mockInstance = new OpenAI({ apiKey: 'test' });
      vi.mocked(mockInstance.chat.completions.create).mockResolvedValue(mockResponse as any);

      const service = new AIService();
      const result = await service.analyzeConflict(
        'System prompt',
        'User prompt'
      );

      expect(result).toEqual({
        success: false,
        error: 'No response from AI'
      });
    });

    it('should handle API errors', async () => {
      const OpenAI = (await import('openai')).default;
      const mockInstance = new OpenAI({ apiKey: 'test' });
      vi.mocked(mockInstance.chat.completions.create).mockRejectedValue(new Error('API Error'));

      const service = new AIService();
      const result = await service.analyzeConflict(
        'System prompt',
        'User prompt'
      );

      expect(result).toEqual({
        success: false,
        error: 'API Error'
      });
    });
  });

  describe('analyzeConflictStructured', () => {
    it('should successfully parse structured JSON response', async () => {
      const mockStructuredResponse = {
        priority: {
          event1: { score: 80, reason: 'High importance' },
          event2: { score: 30, reason: 'Low importance' }
        },
        recommendation: {
          action: 'reschedule',
          target: 'Event 2',
          reason: 'Priority difference',
          confidence: 'high' as const
        },
        alternatives: ['Option 1', 'Option 2']
      };

      const mockResponse = {
        choices: [{
          message: {
            content: JSON.stringify(mockStructuredResponse)
          }
        }]
      };

      const OpenAI = (await import('openai')).default;
      const mockInstance = new OpenAI({ apiKey: 'test' });
      vi.mocked(mockInstance.chat.completions.create).mockResolvedValue(mockResponse as any);

      const service = new AIService();
      const result = await service.analyzeConflictStructured(
        'System prompt',
        'User prompt'
      );

      expect(result).toEqual({
        success: true,
        result: mockStructuredResponse
      });
    });

    it('should handle invalid JSON with fallback structure', async () => {
      const mockResponse = {
        choices: [{
          message: {
            content: 'This is not valid JSON'
          }
        }]
      };

      const OpenAI = (await import('openai')).default;
      const mockInstance = new OpenAI({ apiKey: 'test' });
      vi.mocked(mockInstance.chat.completions.create).mockResolvedValue(mockResponse as any);

      // Mock console.warn to verify it's called
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const service = new AIService();
      const result = await service.analyzeConflictStructured(
        'System prompt',
        'User prompt'
      );

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        priority: {
          event1: { score: 50, reason: 'AI分析結果（構造化失敗）' },
          event2: { score: 50, reason: 'AI分析結果（構造化失敗）' }
        },
        recommendation: {
          action: 'keep',
          target: '',
          reason: 'This is not valid JSON',
          confidence: 'low'
        }
      });

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('analyzeConflictsBatch', () => {
    it('should process batch of conflicts', async () => {
      const mockConflicts = [
        { id: '1', systemPrompt: 'System 1', userPrompt: 'User 1' },
        { id: '2', systemPrompt: 'System 2', userPrompt: 'User 2' },
        { id: '3', systemPrompt: 'System 3', userPrompt: 'User 3' },
        { id: '4', systemPrompt: 'System 4', userPrompt: 'User 4' }
      ];

      const mockResponse = {
        choices: [{
          message: {
            content: 'Analysis result'
          }
        }]
      };

      const OpenAI = (await import('openai')).default;
      const mockInstance = new OpenAI({ apiKey: 'test' });
      vi.mocked(mockInstance.chat.completions.create).mockResolvedValue(mockResponse as any);

      // Mock setTimeout to speed up tests
      vi.useFakeTimers();

      const service = new AIService();
      const resultPromise = service.analyzeConflictsBatch(mockConflicts);
      
      // Fast-forward timers
      await vi.runAllTimersAsync();
      
      const results = await resultPromise;

      expect(results.size).toBe(4);
      expect(results.get('1')).toEqual({
        success: true,
        analysis: 'Analysis result'
      });
      expect(results.get('4')).toEqual({
        success: true,
        analysis: 'Analysis result'
      });

      vi.useRealTimers();
    });
  });
});