import { describe, expect, it } from 'vitest';
import { plainLanguageEntries, plainLanguageFor } from '../plain-language';
import { realItems } from './real-data';

describe('逐筆白話導讀', () => {
  it('涵蓋全部資料，沒有多餘或漏掉的 ID，各欄位完整', () => {
    expect(Object.keys(plainLanguageEntries).sort()).toEqual(realItems.map(i => i.id).sort());
    for (const item of realItems) {
      const entry = plainLanguageFor(item);
      expect(entry, item.id).not.toBeNull();
      for (const key of ['summary', 'audience', 'support', 'firstStep'] as const) {
        expect(entry![key].trim().length, `${item.id}.${key}`).toBeGreaterThan(5);
      }
      expect([...entry!.summary].length, `${item.id}.summary`).toBeLessThanOrEqual(60);
      expect(entry!.cautions.length, item.id).toBeGreaterThan(0);
      expect(entry!.cautions.every(s => s.trim().length > 5), item.id).toBe(true);
    }
  });
  it('資料更新或新 ID 不沿用舊導讀，原文仍可由既有畫面顯示', () => {
    const original = realItems[0]!;
    expect(plainLanguageFor({ ...original, id: 'NEW' })).toBeNull();
    expect(plainLanguageFor({ ...original, benefit: { ...original.benefit, raw: '已更新給付條件' } })).toBeNull();
    expect(plainLanguageFor({ ...original, eligibility: { ...original.eligibility, exclusions: ['新增不能申請的情形'] } })).toBeNull();
  });
  it('API 物件欄位順序不同仍能辨識相同來源', () => {
    const original = realItems[0]!;
    const reorder = Object.fromEntries(Object.entries(original).reverse());
    expect(plainLanguageFor(reorder as typeof original)).toEqual(plainLanguageFor(original));
  });
});
