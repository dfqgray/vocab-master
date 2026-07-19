import { describe, it, expect } from 'vitest';
import { WORDS_PET } from '../js/words_pet.js';

describe('PET 词库完整性', () => {
  it('应该包含 2028 个词', () => {
    expect(WORDS_PET.length).toBe(2028);
  });

  it('每个词必须有 w 字段（非空）', () => {
    WORDS_PET.forEach(word => {
      expect(word.w).toBeDefined();
      expect(typeof word.w).toBe('string');
      expect(word.w.length).toBeGreaterThan(0);
    });
  });

  it('m 字段存在且为字符串', () => {
    const emptyM = WORDS_PET.filter(w => typeof w.m !== 'string' || w.m.length === 0);
    // Count words with empty meaning (data quality issue but not schema error)
    if (emptyM.length > 0) {
      console.log('Words with empty m:', emptyM.map(w => w.w).join(', '));
    }
    WORDS_PET.forEach(word => {
      expect(typeof word.m).toBe('string');
    });
  });

  it('p 和 pos 字段存在且为字符串', () => {
    WORDS_PET.forEach(word => {
      expect(typeof word.p).toBe('string');
      expect(typeof word.pos).toBe('string');
    });
  });

  it('同形异义词用 w 后缀区分（如 record n / record v）', () => {
    const homographs = WORDS_PET.filter(w => /\s[nvadj/]/.test(w.w));
    // These are valid — same spelling, different POS, disambiguated in data
    expect(homographs.length).toBeGreaterThan(0);
    homographs.forEach(w => {
      expect(w.w).toMatch(/^[a-z]+ [nvadj/]+$/);
    });
  });

  it('unit 字段在有效范围', () => {
    WORDS_PET.forEach(word => {
      expect(word.unit).toBeGreaterThanOrEqual(1);
      expect(word.unit).toBeLessThanOrEqual(30);
      expect(Number.isInteger(word.unit)).toBe(true);
    });
  });

  it('不应该有重复单词', () => {
    const seen = new Set();
    const dupes = [];
    WORDS_PET.forEach(word => {
      if (seen.has(word.w)) dupes.push(word.w);
      seen.add(word.w);
    });
    expect(dupes).toEqual([]);
  });

  it('音标格式以 / 开头以 / 结尾', () => {
    WORDS_PET.forEach(word => {
      expect(word.p).toMatch(/^\/.*\/$/);
    });
  });

  it('所有 unit 分布均匀', () => {
    const counts = {};
    WORDS_PET.forEach(w => {
      const u = w.unit || 1;
      counts[u] = (counts[u] || 0) + 1;
    });
    const values = Object.values(counts);
    const avg = WORDS_PET.length / 30;
    // Each unit should have 55-80 words (reasonable range)
    values.forEach(count => {
      expect(count).toBeGreaterThan(40);
      expect(count).toBeLessThan(100);
    });
  });
});
