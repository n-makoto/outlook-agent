import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import {
  getDefaultRulesPath,
  loadSchedulingRules,
  getDefaultRules,
  calculateEventPriority,
  determineConflictAction,
  type SchedulingRules
} from './rules.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn()
}));

// Mock js-yaml
vi.mock('js-yaml', () => ({
  load: vi.fn(),
  dump: vi.fn()
}));

describe('rules utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDefaultRulesPath', () => {
    it('should return the correct default path', () => {
      const expectedPath = path.join(process.cwd(), 'prompts', 'scheduling-rules.yaml');
      expect(getDefaultRulesPath()).toBe(expectedPath);
    });
  });

  describe('loadSchedulingRules', () => {
    const mockRules: SchedulingRules = {
      version: 1.0,
      priorities: {
        critical: [{
          pattern: 'CEO',
          description: 'CEO meetings'
        }],
        high: [{
          keywords: ['important', 'urgent'],
          description: 'Important meetings'
        }],
        medium: [{
          attendees_count: { min: 5, max: 20 },
          description: 'Team meetings'
        }],
        low: [{
          pattern: 'optional',
          description: 'Optional meetings'
        }]
      },
      rules: {
        priority_difference: [{
          if_diff_greater_than: 50,
          then: 'reschedule_lower',
          description: 'Large priority difference'
        }],
        buffer_time: {
          default_minutes: 15,
          between_external_meetings: 30
        }
      },
      learning: {
        enabled: true,
        approval_threshold: 0.8,
        min_samples: 5
      }
    };

    it('should load rules from default path when no path provided', async () => {
      const fs = await import('fs/promises');
      const yaml = await import('js-yaml');
      
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockRules));
      vi.mocked(yaml.load).mockReturnValue(mockRules);

      const result = await loadSchedulingRules();

      expect(result.rules).toEqual(mockRules);
      expect(result.isDefault).toBe(true);
      expect(fs.readFile).toHaveBeenCalledWith(
        expect.stringContaining('scheduling-rules.yaml'),
        'utf-8'
      );
    });

    it('should load rules from custom path', async () => {
      const fs = await import('fs/promises');
      const yaml = await import('js-yaml');
      const customPath = '/custom/path/rules.yaml';
      
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockRules));
      vi.mocked(yaml.load).mockReturnValue(mockRules);

      const result = await loadSchedulingRules(customPath);

      expect(result.rules).toEqual(mockRules);
      expect(result.isDefault).toBe(false);
      expect(result.filePath).toBe(customPath);
      expect(fs.readFile).toHaveBeenCalledWith(customPath, 'utf-8');
    });

    it('should return default rules when default file not found', async () => {
      const fs = await import('fs/promises');
      const error = new Error('ENOENT');
      (error as any).code = 'ENOENT';
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await loadSchedulingRules();

      expect(result.rules).toEqual(getDefaultRules());
      expect(result.filePath).toBe('(内蔵デフォルトルール)');
      expect(result.isDefault).toBe(true);
    });

    it('should throw error when custom file not found', async () => {
      const fs = await import('fs/promises');
      const customPath = '/custom/path/rules.yaml';
      const error = new Error('ENOENT');
      (error as any).code = 'ENOENT';
      vi.mocked(fs.readFile).mockRejectedValue(error);

      await expect(loadSchedulingRules(customPath)).rejects.toThrow(
        `指定されたルールファイルが見つかりません: ${customPath}`
      );
    });
  });

  describe('getDefaultRules', () => {
    it('should return minimal default rules', () => {
      const rules = getDefaultRules();

      expect(rules).toEqual({
        version: 1.0,
        priorities: {
          critical: [],
          high: [],
          medium: [],
          low: []
        },
        rules: {
          buffer_time: {
            default_minutes: 15
          }
        }
      });
    });
  });

  describe('calculateEventPriority', () => {
    const mockRules: SchedulingRules = {
      version: 1.0,
      priorities: {
        critical: [{
          pattern: 'CEO|Board',
          description: 'Executive meetings'
        }],
        high: [{
          keywords: ['important', 'urgent'],
          attendees_count: { min: 10 },
          description: 'High priority meetings'
        }],
        medium: [{
          organizer_patterns: ['@company.com'],
          description: 'Internal meetings'
        }],
        low: [{
          pattern: 'optional',
          exclude_pattern: 'mandatory',
          description: 'Optional meetings'
        }]
      }
    };

    it('should calculate critical priority', () => {
      const event = {
        subject: 'Meeting with CEO',
        attendees: [],
        organizer: { emailAddress: { address: 'someone@example.com' } }
      };

      const result = calculateEventPriority(event, mockRules);

      expect(result).toEqual({
        score: 100,
        level: 'critical',
        reasons: ['Executive meetings']
      });
    });

    it('should calculate high priority with keywords and attendees', () => {
      const event = {
        subject: 'Important team sync',
        attendees: new Array(15).fill({}),
        organizer: { emailAddress: { address: 'manager@example.com' } }
      };

      const result = calculateEventPriority(event, mockRules);

      expect(result).toEqual({
        score: 75,
        level: 'high',
        reasons: ['High priority meetings']
      });
    });

    it('should return default priority when no rules match', () => {
      const event = {
        subject: 'Random meeting',
        attendees: [],
        organizer: { emailAddress: { address: 'random@random.com' } }
      };

      const result = calculateEventPriority(event, mockRules);

      expect(result).toEqual({
        score: 50,
        level: 'medium',
        reasons: ['Default priority']
      });
    });
  });

  describe('determineConflictAction', () => {
    const mockRules: SchedulingRules = {
      version: 1.0,
      priorities: {},
      rules: {
        priority_difference: [
          {
            if_diff_greater_than: 50,
            then: 'reschedule_lower',
            description: 'Large priority difference'
          },
          {
            if_diff_less_than: 20,
            then: 'keep_both',
            description: 'Small priority difference'
          }
        ]
      }
    };

    it('should determine action for large priority difference', () => {
      const result = determineConflictAction(60, mockRules);

      expect(result).toEqual({
        action: 'reschedule_lower',
        description: 'Large priority difference'
      });
    });

    it('should determine action for small priority difference', () => {
      const result = determineConflictAction(15, mockRules);

      expect(result).toEqual({
        action: 'keep_both',
        description: 'Small priority difference'
      });
    });

    it('should return manual_decision when no matching rule', () => {
      // Using value exactly 50 which is an edge case that doesn't match any rule
      // Not > 50, not < 20, not < 50
      const result = determineConflictAction(50, mockRules);

      expect(result).toEqual({
        action: 'manual_decision',
        description: 'No matching rule'
      });
    });

    it('should return manual_decision when no rules defined', () => {
      const noRules: SchedulingRules = {
        version: 1.0,
        priorities: {}
      };

      const result = determineConflictAction(50, noRules);

      expect(result).toEqual({
        action: 'manual_decision',
        description: 'No rules defined'
      });
    });
  });
});