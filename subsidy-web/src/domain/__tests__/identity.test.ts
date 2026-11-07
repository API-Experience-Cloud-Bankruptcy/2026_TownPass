import { describe, expect, it } from 'vitest';
import { IDENTITY_GATES, identityGateFor, identityStatus } from '../identity';
import { rankQuestions } from '../adaptive';
import { buildLocalQuestions, withIdentitySupport } from '../questions';
import { filterCatalog } from '../situations';
import { validExtraValue } from '../answer-fields';
import { realItem, realItems } from './real-data';

describe('來源綁定的身分前提', () => {
  it('每一筆都綁定現有原文，原文變更即停用', () => {
    for (const gate of IDENTITY_GATES) {
      const item = realItem(gate.id);
      expect(identityGateFor(item), gate.id).toEqual(gate);
      const changed = structuredClone(item);
      changed.name = `${item.name}（改）`;
      expect(identityGateFor(changed)).toBeNull();
    }
    expect(new Set(IDENTITY_GATES.map(g => g.id)).size).toBe(IDENTITY_GATES.length);
  });
  it('未回答為待確認，「都不是」只對特殊身分移出聚焦；收入身分不符只降序', () => {
    const farmer = realItem('CT-0034'), mid = realItem('CT-0104'), open = realItem('CT-0067');
    expect(identityStatus(open, {})).toBe('none');
    expect(identityStatus(farmer, {})).toBe('unknown');
    expect(identityStatus(farmer, { extra: { special_identity: 'farmer' } })).toBe('met');
    expect(identityStatus(farmer, { extra: { special_identity: 'veteran' } })).toBe('unmet');
    expect(identityStatus(farmer, { extra: { special_identity: 'none' } })).toBe('conflict');
    expect(identityStatus(mid, { household_type: 'mid_low_income' })).toBe('met');
    expect(identityStatus(mid, { household_type: 'general' })).toBe('unmet');
  });
  it('身分答案只接受固定選項', () => {
    expect(validExtraValue('special_identity', 'none')).toBe(true);
    expect(validExtraValue('special_identity', '自填身分')).toBe(false);
  });
  it('補充題庫不改動共用模板題的其他支撐', () => {
    const base = buildLocalQuestions(realItems);
    const bank = withIdentitySupport(base, realItems);
    expect(bank.find(q => q.field === 'special_identity')?.resource_ids).toEqual(['CT-0034', 'CT-0069', 'CT-0099', 'CT-0149']);
    expect(bank.find(q => q.field === 'household_type')?.resource_ids).toContain('CT-0104');
    for (const q of base) if (q.field !== 'household_type') expect(bank.find(x => x.id === q.id)).toBe(q);
  });
});

describe('身分題只在剩餘結果依身分分歧時提出', () => {
  const items = filterCatalog(realItems, 'elder', '');
  const bank = withIdentitySupport(buildLocalQuestions(items), items);
  it('尚未縮小時先問需求，不先問身分', () => {
    expect(rankQuestions(bank, items, {}, 'elder', new Set())[0].field).toBe('elder_support');
  });
  it('長者日常生活津貼、78 歲後下一題問身分', () => {
    const answers = { age: 78, extra: { elder_support: 'allowance' } };
    const ranked = rankQuestions(bank, items, answers, 'elder', new Set(['q-elder-support', 'q-age']));
    expect(ranked[0].field).toBe('special_identity');
    expect(ranked.map(q => q.field)).toContain('household_type');
  });
});
