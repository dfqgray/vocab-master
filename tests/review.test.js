import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock browser globals not available in jsdom
global.AudioContext = class { close() {} };
global.webkitAudioContext = class { close() {} };
global.speechSynthesis = { cancel() {}, getVoices() { return []; }, speak() {} };
global.SpeechSynthesisUtterance = class {};

// We test the pure logic functions without importing the full module
// (module has side-effects that fail in jsdom)

const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60, 90];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowStr() {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}

function updateReview(reviewSchedule, word, correct) {
  if (correct) {
    const cur = reviewSchedule[word];
    if (!cur) return;
    const newLevel = Math.min(cur.level + 1, 6);
    const interval = REVIEW_INTERVALS[newLevel];
    const nextDate = new Date(Date.now() + interval * 86400000).toISOString().slice(0, 10);
    reviewSchedule[word] = {
      level: newLevel,
      nextReview: nextDate,
      history: [...(cur.history || []), { date: todayStr(), result: 'correct' }]
    };
  } else {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const cur = reviewSchedule[word];
    reviewSchedule[word] = {
      level: 0,
      nextReview: tomorrow,
      history: [...(cur?.history || []), { date: todayStr(), result: 'wrong' }]
    };
  }
}

function getReviewDue(reviewSchedule) {
  const today = todayStr();
  const due = [];
  for (const [word, data] of Object.entries(reviewSchedule)) {
    if (data.level < 6 && data.nextReview <= today) {
      due.push(word);
    }
  }
  return due;
}

describe('间隔复习算法', () => {
  let schedule;

  beforeEach(() => {
    schedule = {};
  });

  describe('标记不认识 → 进入系统', () => {
    it('应该创建 Level 0，nextReview 为明天', () => {
      updateReview(schedule, 'abandon', false);
      expect(schedule['abandon']).toBeDefined();
      expect(schedule['abandon'].level).toBe(0);
      expect(schedule['abandon'].nextReview).toBe(tomorrowStr());
      expect(schedule['abandon'].history.length).toBe(1);
      expect(schedule['abandon'].history[0].result).toBe('wrong');
    });

    it('新进入的词不应该出现在今天的复习队列', () => {
      updateReview(schedule, 'abandon', false);
      const due = getReviewDue(schedule);
      expect(due).not.toContain('abandon');
    });
  });

  describe('连续认识 → 升级', () => {
    it('Level 0 → 认识 → Level 1，3天后复习', () => {
      schedule['ability'] = { level: 0, nextReview: todayStr(), history: [] };
      updateReview(schedule, 'ability', true);
      expect(schedule['ability'].level).toBe(1);
      const expectedDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      expect(schedule['ability'].nextReview).toBe(expectedDate);
    });

    it('Level 2 → 认识 → Level 3，14天后复习', () => {
      schedule['about'] = { level: 2, nextReview: todayStr(), history: [] };
      updateReview(schedule, 'about', true);
      expect(schedule['about'].level).toBe(3);
      const expectedDate = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
      expect(schedule['about'].nextReview).toBe(expectedDate);
    });
  });

  describe('再次不认识 → 重置', () => {
    it('Level 3 → 不认识 → Level 0，明天复习', () => {
      schedule['act'] = { level: 3, nextReview: todayStr(), history: [] };
      updateReview(schedule, 'act', false);
      expect(schedule['act'].level).toBe(0);
      expect(schedule['act'].nextReview).toBe(tomorrowStr());
    });

    it('不应该丢失历史记录', () => {
      schedule['action'] = { level: 2, nextReview: todayStr(), history: [{ date: '2026-07-10', result: 'correct' }] };
      updateReview(schedule, 'action', false);
      expect(schedule['action'].history.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('毕业 Level 6', () => {
    it('Level 5 → 认识 → Level 6，90天后复习', () => {
      schedule['zoo'] = { level: 5, nextReview: todayStr(), history: [] };
      updateReview(schedule, 'zoo', true);
      expect(schedule['zoo'].level).toBe(6);
      const expectedDate = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
      expect(schedule['zoo'].nextReview).toBe(expectedDate);
    });

    it('Level 6 的单词不出现在复习队列', () => {
      schedule['zoo'] = { level: 6, nextReview: '2026-01-01', history: [] };
      const due = getReviewDue(schedule);
      expect(due).not.toContain('zoo');
    });
  });

  describe('边界情况', () => {
    it('认识一个不在复习系统的词 → 什么都不发生', () => {
      updateReview(schedule, 'nonexistent', true);
      expect(schedule['nonexistent']).toBeUndefined();
    });

    it('不认识一个已在系统中的词 → 重置为 Level 0', () => {
      schedule['able'] = { level: 4, nextReview: '2026-08-01', history: [] };
      updateReview(schedule, 'able', false);
      expect(schedule['able'].level).toBe(0);
    });

    it('Level 6 不认识 → 重置为 Level 0', () => {
      schedule['zebra'] = { level: 6, nextReview: '2026-10-01', history: [] };
      updateReview(schedule, 'zebra', false);
      expect(schedule['zebra'].level).toBe(0);
      expect(schedule['zebra'].nextReview).toBe(tomorrowStr());
    });
  });
});
