import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import { homedir } from 'os';
import * as crypto from 'crypto';
import { DecisionMemory } from './memory.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  appendFile: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn()
}));

// Mock config
vi.mock('../../utils/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    dataRetention: { decisionsDays: 90 }
  })
}));

describe('DecisionMemory', () => {
  let memory: DecisionMemory;
  const mockBaseDir = path.join(homedir(), '.outlook-agent', 'decisions');
  
  beforeEach(() => {
    memory = new DecisionMemory();
    vi.clearAllMocks();
    // Reset console mocks
    (global.console.log as any).mockClear();
    (global.console.warn as any).mockClear();
  });

  describe('recordDecision', () => {
    it('should create directory and record decision in JSONL format', async () => {
      const fs = await import('fs/promises');
      const mockDecision = {
        id: 'test-id',
        timestamp: '2024-01-01T10:00:00Z',
        conflictHash: 'test-hash',
        proposedAction: {
          type: 'reschedule' as const,
          targetPriority: 30,
          priorityDiff: 50
        },
        userAction: {
          type: 'approve' as const,
          modified: false
        }
      };

      vi.mocked(fs.mkdir).mockResolvedValue(undefined as any);
      vi.mocked(fs.appendFile).mockResolvedValue(undefined as any);
      vi.mocked(fs.readdir).mockResolvedValue([]);

      await memory.recordDecision(mockDecision);

      expect(fs.mkdir).toHaveBeenCalledWith(mockBaseDir, { recursive: true });
      expect(fs.appendFile).toHaveBeenCalledWith(
        expect.stringContaining('.jsonl'),
        JSON.stringify(mockDecision) + '\n',
        'utf-8'
      );
    });

    it('should handle cleanup after recording', async () => {
      const fs = await import('fs/promises');
      const mockDecision = {
        id: 'test-id',
        timestamp: '2024-01-01T10:00:00Z',
        conflictHash: 'test-hash',
        proposedAction: {
          type: 'keep' as const,
          targetPriority: 50,
          priorityDiff: 0
        },
        userAction: {
          type: 'skip' as const,
          modified: false
        }
      };

      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);
      const oldFileName = `${oldDate.toISOString().split('T')[0]}.jsonl`;

      vi.mocked(fs.mkdir).mockResolvedValue(undefined as any);
      vi.mocked(fs.appendFile).mockResolvedValue(undefined as any);
      vi.mocked(fs.readdir).mockResolvedValue([oldFileName] as any);
      vi.mocked(fs.unlink).mockResolvedValue(undefined as any);

      await memory.recordDecision(mockDecision);

      expect(fs.unlink).toHaveBeenCalledWith(
        path.join(mockBaseDir, oldFileName)
      );
    });
  });

  describe('createDecisionRecord', () => {
    it('should create a decision record from conflict data', () => {
      const mockConflict = {
        timeRange: '10:00-11:00',
        events: [
          { priority: { score: 80 }, attendeesCount: 5 },
          { priority: { score: 30 }, attendeesCount: 2 }
        ]
      };

      const mockProposal = {
        events: mockConflict.events,
        suggestion: {
          action: 'リスケジュール recommended'
        }
      };

      const decision = memory.createDecisionRecord(
        mockConflict,
        mockProposal,
        'approve'
      );

      expect(decision).toMatchObject({
        proposedAction: {
          type: 'reschedule',
          targetPriority: 30,
          priorityDiff: 50
        },
        userAction: {
          type: 'approve',
          modified: false
        },
        patterns: {
          priorityDiff: 50,
          attendeesCount: 7,
          isRecurring: false
        }
      });
      expect(decision.id).toBeDefined();
      expect(typeof decision.id).toBe('string');
    });

    it('should handle decline action extraction', () => {
      const mockConflict = {
        timeRange: '14:00-15:00',
        events: [
          { priority: { score: 90 } },
          { priority: { score: 20 } }
        ]
      };

      const mockProposal = {
        events: mockConflict.events,
        suggestion: {
          action: '辞退を検討'
        }
      };

      const decision = memory.createDecisionRecord(
        mockConflict,
        mockProposal,
        'modify',
        'keep both meetings'
      );

      expect(decision.proposedAction.type).toBe('decline');
      expect(decision.userAction.type).toBe('modify');
      expect(decision.userAction.modified).toBe(true);
      expect(decision.userAction.finalAction).toBe('keep');
    });
  });

  describe('suggestPattern', () => {
    it('should return empty array when insufficient data', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const patterns = await memory.suggestPattern();
      expect(patterns).toEqual([]);
    });

    it('should analyze patterns from recent decisions', async () => {
      const fs = await import('fs/promises');
      const mockDecisions = Array(10).fill(null).map((_, i) => ({
        id: `id-${i}`,
        timestamp: new Date().toISOString(),
        conflictHash: `hash-${i}`,
        proposedAction: {
          type: 'reschedule' as const,
          targetPriority: 30,
          priorityDiff: 60
        },
        userAction: {
          type: i < 8 ? 'approve' as const : 'skip' as const,
          modified: false
        },
        patterns: {
          priorityDiff: 60,
          attendeesCount: 5,
          isRecurring: false,
          timeOfDay: 'morning',
          dayOfWeek: 1
        }
      }));

      const jsonlContent = mockDecisions
        .map(d => JSON.stringify(d))
        .join('\n');

      vi.mocked(fs.readdir).mockResolvedValue([
        `${new Date().toISOString().split('T')[0]}.jsonl`
      ] as any);
      vi.mocked(fs.readFile).mockResolvedValue(jsonlContent);

      const patterns = await memory.suggestPattern();

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0]).toMatchObject({
        approvalRate: expect.any(Number),
        sampleCount: expect.any(Number),
        suggestedAction: expect.any(String)
      });
      expect(patterns[0].approvalRate).toBeGreaterThan(0.7);
    });
  });

  describe('recordFeedback', () => {
    it('should update decision with feedback', async () => {
      const fs = await import('fs/promises');
      const mockDecision = {
        id: 'feedback-test-id',
        timestamp: new Date().toISOString(),
        conflictHash: 'feedback-hash',
        proposedAction: {
          type: 'reschedule' as const,
          targetPriority: 40,
          priorityDiff: 30
        },
        userAction: {
          type: 'approve' as const,
          modified: false
        }
      };

      vi.mocked(fs.readdir).mockResolvedValue([
        `${new Date().toISOString().split('T')[0]}.jsonl`
      ] as any);
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(mockDecision)
      );
      vi.mocked(fs.mkdir).mockResolvedValue(undefined as any);
      vi.mocked(fs.appendFile).mockResolvedValue(undefined as any);

      await memory.recordFeedback(
        'feedback-test-id',
        true,
        'Great suggestion!'
      );

      expect(fs.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"wasSuccessful":true'),
        'utf-8'
      );
      expect(fs.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('"userComment":"Great suggestion!"'),
        'utf-8'
      );
    });
  });

  describe('getStatistics', () => {
    it('should return zero statistics when no data', async () => {
      const fs = await import('fs/promises');
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const stats = await memory.getStatistics();

      expect(stats).toEqual({
        totalDecisions: 0,
        approvalRate: 0,
        modificationRate: 0,
        skipRate: 0,
        topPatterns: []
      });
    });

    it('should calculate correct statistics', async () => {
      const fs = await import('fs/promises');
      const decisions = [
        { userAction: { type: 'approve' }, patterns: { priorityDiff: 60 } },
        { userAction: { type: 'approve' }, patterns: { priorityDiff: 65 } },
        { userAction: { type: 'modify' }, patterns: { priorityDiff: 30 } },
        { userAction: { type: 'skip' }, patterns: { priorityDiff: 20 } },
        { userAction: { type: 'approve' }, patterns: { priorityDiff: 70 } }
      ];

      const jsonlContent = decisions
        .map(d => JSON.stringify({
          ...d,
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          conflictHash: crypto.randomUUID(),
          proposedAction: { type: 'reschedule', targetPriority: 30, priorityDiff: 50 }
        }))
        .join('\n');

      vi.mocked(fs.readdir).mockResolvedValue([
        `${new Date().toISOString().split('T')[0]}.jsonl`
      ] as any);
      vi.mocked(fs.readFile).mockResolvedValue(jsonlContent);

      const stats = await memory.getStatistics();

      expect(stats.totalDecisions).toBe(5);
      expect(stats.approvalRate).toBeCloseTo(0.6); // 3/5
      expect(stats.modificationRate).toBeCloseTo(0.2); // 1/5
      expect(stats.skipRate).toBeCloseTo(0.2); // 1/5
    });
  });

  describe('error handling', () => {
    it('should handle ENOENT errors gracefully in loadRecentDecisions', async () => {
      const fs = await import('fs/promises');
      const error = new Error('ENOENT: no such file or directory');
      (error as any).code = 'ENOENT';
      vi.mocked(fs.readdir).mockRejectedValue(error);

      const patterns = await memory.suggestPattern();
      expect(patterns).toEqual([]);
    });

    it('should propagate non-ENOENT errors', async () => {
      const fs = await import('fs/promises');
      const error = new Error('Permission denied');
      (error as any).code = 'EACCES';
      vi.mocked(fs.readdir).mockRejectedValue(error);

      await expect(memory.suggestPattern()).rejects.toThrow('Permission denied');
    });
  });
});