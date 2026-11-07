import { describe, expect, it } from 'vitest';
import { buildPlanText, DISCLAIMER, shareText } from '../export';
import { evaluateAll } from '../match';
import { ageRule, makeSubsidy } from './fixtures';

const meta = { catalogVersion: 'catalog-v1-test', sourceLabel: '測試', generatedAt: new Date('2026-11-07T00:00:00') };

describe('行動單文字', () => {
  const item = makeSubsidy({
    eligibility: { age: [ageRule('65歲以上', 65, null)] } as any,
    application: { deadline: { type: 'fixed', raw: '至2026-01-31', start: null, end: '2026-01-31' } },
  } as any);
  const results = evaluateAll([item], { age: 40 }, '2026-11-07');
  const base = { meta, target: 'other' as const, items: [item], results, docChecks: {}, stepDone: {} };

  it('含聲明、來源、版本與時效；未審閱的年齡不冒稱已知不符', () => {
    const t = buildPlanText({ ...base, conditions: [] });
    expect(t).toContain(DISCLAIMER);
    expect(t).toContain('catalog-v1-test');
    expect(t).toContain('2026-01-31');
    expect(t).not.toContain('不符原因');
    expect(t).toContain('65歲以上');
  });

  it('未勾選條件時不洩露填答年齡', () => {
    const t = buildPlanText({ ...base, conditions: [] });
    expect(t).not.toContain('40 歲');
    expect(t).toContain('不含個人填答');
  });

  it('勾選年齡後才輸出含值說明', () => {
    const t = buildPlanText({ ...base, conditions: [{ field: 'age', line: '對方今年幾歲：40 歲' }] });
    expect(t).toContain('40 歲');
  });
});

describe('紙本交接完整性', () => {
  it('輸出全部待確認項目與來源備註', () => {
    const exclusions = ['排除一', '排除二', '排除三', '排除四', '排除五', '排除六', '排除七', '排除八', '排除九'];
    const item = makeSubsidy({
      eligibility: { exclusions, raw_summary: '測試對象' } as any,
      source_meta: { notes: '資格細節依公告', verification_note: '官方頁已讀取' },
    } as any);
    const results = evaluateAll([item], {});
    expect(results.get(item.id)!.pending!.length).toBeGreaterThan(8);
    const t = buildPlanText({ meta, target: 'self', items: [item], results, conditions: [], docChecks: {}, stepDone: {} });
    for (const ex of exclusions) expect(t).toContain(ex);
    expect(t).not.toContain('見官方說明');
    expect(t).toContain('資料備註：資格細節依公告');
    expect(t).toContain('查核說明：官方頁已讀取');
  });
});

describe('分享結果區分', () => {
  it('取消與失敗不同', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    expect(await shareText('t', 'b', { share: () => Promise.reject(abort) } as any)).toBe('cancelled');
    expect(await shareText('t', 'b', { share: () => Promise.reject(new Error('boom')) } as any)).toBe('failed');
    expect(await shareText('t', 'b', { share: () => Promise.resolve() } as any)).toBe('shared');
    expect(await shareText('t', 'b', {} as any)).toBe('unsupported');
  });
});
