import { describe, expect, it } from 'vitest';
import { identityRanking } from '../domain/adaptive';
import { realItem } from '../domain/__tests__/real-data';
import { buildLocalQuestions } from '../domain/questions';
import { validExtraValue } from '../domain/answer-fields';

describe('整合後保留主線獨立身分問答', () => {
  it('農保未知須確認，肯定或否定答案均不再視為未答', () => {
    const item = realItem('CT-0034');
    expect(identityRanking(item, {}).unconfirmed).toBeGreaterThan(0);
    for (const value of [true, false]) {
      expect(identityRanking(item, { extra: { has_farmer_insurance: value } }).unconfirmed).toBe(0);
      expect(validExtraValue('has_farmer_insurance', value)).toBe(true);
    }
  });
  it('農保與榮民分開保存，不導入互斥的單選身分', () => {
    const bank = buildLocalQuestions([realItem('CT-0034'), realItem('CT-0099')]);
    expect(bank.map(q => q.field)).toContain('has_farmer_insurance');
    expect(bank.map(q => q.field)).toContain('veteran_status');
    expect(bank.map(q => q.field)).not.toContain('special_identity');
  });
});
