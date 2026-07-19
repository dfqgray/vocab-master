import { describe, it, expect, beforeEach } from 'vitest';

// Simulate the textbook_loader save/load pattern
function progressKey(tid) {
  return 'pvm_progress_' + tid;
}

function saveProgress(tid, data) {
  localStorage.setItem(progressKey(tid), JSON.stringify(data));
}

function loadProgress(tid) {
  try {
    const raw = localStorage.getItem(progressKey(tid));
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return { wordStates: {}, wrongWords: [], starredWords: [], reviewSchedule: {}, game: { xp: 0, streak: 0, level: 1, hearts: 5, todayXP: 0, achievements: {} } };
}

describe('localStorage 进度存储', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('保存和读取进度数据循环一致', () => {
    const data = {
      wordStates: { ability: 'known', abandon: 'learning' },
      wrongWords: ['abandon'],
      starredWords: ['ability'],
      reviewSchedule: {
        abandon: { level: 0, nextReview: '2026-07-20', history: [{ date: '2026-07-19', result: 'wrong' }] }
      },
      game: { xp: 150, streak: 3, level: 2, hearts: 4, todayXP: 25, achievements: { first10: true } }
    };

    saveProgress('pet2020', data);
    const loaded = loadProgress('pet2020');

    expect(loaded.wordStates).toEqual(data.wordStates);
    expect(loaded.wrongWords).toEqual(data.wrongWords);
    expect(loaded.starredWords).toEqual(data.starredWords);
    expect(loaded.reviewSchedule).toEqual(data.reviewSchedule);
    expect(loaded.game.xp).toBe(150);
    expect(loaded.game.streak).toBe(3);
  });

  it('不同教材的进度完全隔离', () => {
    saveProgress('pet2020', { wordStates: { a: 'known' }, game: { xp: 100 } });
    saveProgress('ket', { wordStates: { b: 'learning' }, game: { xp: 50 } });

    const pet = loadProgress('pet2020');
    const ket = loadProgress('ket');

    expect(pet.wordStates).toEqual({ a: 'known' });
    expect(ket.wordStates).toEqual({ b: 'learning' });
    expect(pet.game.xp).toBe(100);
    expect(ket.game.xp).toBe(50);
  });

  it('新教材返回默认空进度', () => {
    const progress = loadProgress('new_textbook');
    expect(progress.wordStates).toEqual({});
    expect(progress.wrongWords).toEqual([]);
    expect(progress.reviewSchedule).toEqual({});
    expect(progress.game.xp).toBe(0);
    expect(progress.game.level).toBe(1);
  });

  it('空 reviewSchedule 应正确序列化', () => {
    const data = { wordStates: {}, reviewSchedule: {}, game: { xp: 0 } };
    saveProgress('test', data);
    const loaded = loadProgress('test');
    expect(loaded.reviewSchedule).toEqual({});
  });

  it('复杂嵌套结构保存后再读取不丢失', () => {
    const complex = {
      wordStates: {},
      reviewSchedule: {
        abandon: {
          level: 4,
          nextReview: '2026-09-15',
          history: [
            { date: '2026-07-01', result: 'wrong' },
            { date: '2026-07-02', result: 'correct' },
            { date: '2026-07-05', result: 'correct' },
            { date: '2026-07-12', result: 'correct' },
            { date: '2026-07-26', result: 'correct' },
          ]
        }
      },
      game: { xp: 500, streak: 7, achievements: { first10: true, first50: true, streak7: true } }
    };
    saveProgress('pet2020', complex);
    const loaded = loadProgress('pet2020');
    expect(loaded.reviewSchedule.abandon.level).toBe(4);
    expect(loaded.reviewSchedule.abandon.history.length).toBe(5);
    expect(loaded.game.achievements.first50).toBe(true);
  });
});
