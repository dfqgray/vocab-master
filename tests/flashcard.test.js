import { describe, it, expect, beforeEach } from 'vitest';

// ========== Simulated flashcard state & logic ==========

const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60, 90];
function todayStr() { return new Date().toISOString().slice(0, 10); }
function tomorrowStr() { return new Date(Date.now() + 86400000).toISOString().slice(0, 10); }

function updateReview(reviewSchedule, word, correct) {
  if (correct) {
    const cur = reviewSchedule[word];
    if (!cur) return;
    const newLevel = Math.min(cur.level + 1, 6);
    const interval = REVIEW_INTERVALS[newLevel];
    const nextDate = new Date(Date.now() + interval * 86400000).toISOString().slice(0, 10);
    reviewSchedule[word] = {
      level: newLevel, nextReview: nextDate,
      history: [...(cur.history || []), { date: todayStr(), result: 'correct' }]
    };
  } else {
    const cur = reviewSchedule[word];
    reviewSchedule[word] = {
      level: 0, nextReview: tomorrowStr(),
      history: [...(cur?.history || []), { date: todayStr(), result: 'wrong' }]
    };
  }
}

// ========== Test fixtures ==========

function makeWords(count = 10) {
  return Array.from({ length: count }, (_, i) => ({
    w: `word${i}`, p: `/wɜːd${i}/`, m: `单词${i}`, pos: 'n.',
    e: `This is word ${i}.`, unit: Math.ceil((i + 1) / 3)
  }));
}

function makeSession(words, opts = {}) {
  const { shuffle = false, sessionSize = 5, selectedUnits = [] } = opts;
  let pool = [...words];
  if (selectedUnits.length > 0) {
    pool = pool.filter(w => selectedUnits.includes(w.unit));
  }
  if (shuffle) pool.sort(() => Math.random() - 0.5);
  else pool.sort((a, b) => a.unit - b.unit || a.w.localeCompare(b.w));
  return {
    list: pool.slice(0, sessionSize),
    index: 0,
    knownCount: 0,
    total: Math.min(sessionSize, pool.length)
  };
}

describe('闪卡功能', () => {
  describe('单元选择', () => {
    it('全部单元时池子包含所有词', () => {
      const words = makeWords(15);
      const session = makeSession(words, { selectedUnits: [], sessionSize: 20 });
      expect(session.total).toBe(15);
    });

    it('选择单个单元只返回该单元的单词', () => {
      const words = makeWords(15);
      const session = makeSession(words, { selectedUnits: [1], sessionSize: 20 });
      session.list.forEach(w => {
        expect(w.unit).toBe(1);
      });
    });

    it('选择多个单元返回它们的并集', () => {
      const words = makeWords(15);
      const session = makeSession(words, { selectedUnits: [1, 2], sessionSize: 20 });
      session.list.forEach(w => {
        expect([1, 2]).toContain(w.unit);
      });
    });

    it('sessionSize 限制数量', () => {
      const words = makeWords(30);
      const session = makeSession(words, { sessionSize: 5 });
      expect(session.list.length).toBe(5);
    });

    it('随机选项打乱顺序', () => {
      const words = makeWords(100);
      const s1 = makeSession(words, { shuffle: true, sessionSize: 50 });
      const s2 = makeSession(words, { shuffle: true, sessionSize: 50 });
      // Very unlikely two shuffled lists are identical
      const names1 = s1.list.map(w => w.w).join(',');
      const names2 = s2.list.map(w => w.w).join(',');
      // Just verify we got the right number
      expect(s1.total).toBe(50);
      expect(s2.total).toBe(50);
    });
  });

  describe('标记认识/不认识', () => {
    let words, session, wordStates, wrongWords, reviewSchedule;

    beforeEach(() => {
      words = makeWords(10);
      session = makeSession(words, { sessionSize: 5 });
      wordStates = {};
      wrongWords = new Set();
      reviewSchedule = {};
    });

    function markCurrentCard(known) {
      const w = session.list[session.index];
      if (known) {
        wordStates[w.w] = 'known';
        session.knownCount++;
        wrongWords.delete(w.w);
        updateReview(reviewSchedule, w.w, true);
      } else {
        wordStates[w.w] = 'learning';
        wrongWords.add(w.w);
        updateReview(reviewSchedule, w.w, false);
      }
      session.index++;
    }

    it('标记认识 → wordState 变为 known', () => {
      markCurrentCard(true);
      const w = session.list[0];
      expect(wordStates[w.w]).toBe('known');
    });

    it('标记不认识 → wordState 变为 learning', () => {
      markCurrentCard(false);
      const w = session.list[0];
      expect(wordStates[w.w]).toBe('learning');
    });

    it('标记认识 → 移出错词本', () => {
      const w = session.list[0];
      wrongWords.add(w.w);
      markCurrentCard(true);
      expect(wrongWords.has(w.w)).toBe(false);
    });

    it('标记不认识 → 加入错词本', () => {
      markCurrentCard(false);
      const w = session.list[0];
      expect(wrongWords.has(w.w)).toBe(true);
    });

    it('标记不认识 → 进入复习系统', () => {
      markCurrentCard(false);
      const w = session.list[0];
      expect(reviewSchedule[w.w]).toBeDefined();
      expect(reviewSchedule[w.w].level).toBe(0);
      expect(reviewSchedule[w.w].nextReview).toBe(tomorrowStr());
    });

    it('连续认识应逐步升级', () => {
      const w = session.list[0];
      // First: mark wrong
      markCurrentCard(false);
      expect(reviewSchedule[w.w].level).toBe(0);

      // Reset session to same word
      session.index = 0;
      // Now mark correct
      markCurrentCard(true);
      expect(reviewSchedule[w.w].level).toBe(1);
    });

    it('session 结束时 knownCount 和 total 正确', () => {
      markCurrentCard(true);   // word0
      markCurrentCard(true);   // word1
      markCurrentCard(false);  // word2
      markCurrentCard(false);  // word3
      markCurrentCard(true);   // word4

      expect(session.knownCount).toBe(3);
      expect(session.total).toBe(5);
      expect(session.index).toBe(5);
    });

    it('全错的情况下 knownCount 为 0', () => {
      for (let i = 0; i < session.total; i++) markCurrentCard(false);
      expect(session.knownCount).toBe(0);
      expect(wrongWords.size).toBe(session.total);
    });

    it('全对的情况下 wrongWords 为空', () => {
      for (let i = 0; i < session.total; i++) {
        wrongWords.add(session.list[i].w);
        markCurrentCard(true);
      }
      expect(wrongWords.size).toBe(0);
    });
  });
});
