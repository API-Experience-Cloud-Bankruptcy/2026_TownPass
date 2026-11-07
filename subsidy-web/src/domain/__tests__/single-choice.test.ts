// Issue #61: a choice question needs two real options that change the surviving resources.
import { describe, expect, it } from 'vitest';
import { rankQuestions } from '../adaptive';
import { buildLocalQuestions } from '../questions';
import { filterCatalog } from '../situations';
import { realItems } from './real-data';

describe('#61 選擇題至少兩個會分流的選項', () => {
  const items = filterCatalog(realItems, 'elder', '');
  const bank = buildLocalQuestions(items);
  it('選項會分流時照常提出', () => {
    const style = rankQuestions(bank, items, {}, 'elder', new Set()).find(q => q.field === 'benefit_style');
    expect(style?.options?.length).toBeGreaterThanOrEqual(2);
  });
  it('長者日常生活津貼、78 歲後只剩「現金補助或津貼」時略過', () => {
    const answers = { age: 78, extra: { elder_support: 'allowance' } };
    const ranked = rankQuestions(bank, items, answers, 'elder', new Set(['q-elder-support', 'q-age']));
    expect(ranked.map(q => q.field)).not.toContain('benefit_style');
    for (const q of ranked) if (q.kind !== 'number') expect(q.options?.length, q.field).toBeGreaterThanOrEqual(2);
  });
});
