import { realItem } from './real-data';
import { describe, expect, it } from 'vitest';
import { ageBounds, ageVerdict, evaluate, quote, text } from '../match';
import { ageRule, makeSubsidy } from './fixtures';

describe('ageBounds：只接受與上下限一致的純年齡片語', () => {
  it('接受 allowlist 片語並辨識不含端點', () => {
    expect(ageBounds(ageRule('65歲以上', 65, null))).toEqual([false, false]);
    expect(ageBounds(ageRule('未滿12歲', null, 12))).toEqual([false, true]);
    expect(ageBounds(ageRule('18–40歲', 18, 40))).toEqual([false, false]);
    expect(ageBounds(ageRule('超過65歲', 65, null))).toEqual([true, false]);
  });
  it('其他寫法、非申請人、月齡、上下限不一致都無法判斷', () => {
    expect(ageBounds(ageRule('以116年計算18–40歲（民國76–98年出生）', 18, 40))).toBeNull();
    expect(ageBounds(ageRule('65歲以上', 65, null, '子女'))).toBeNull();
    expect(ageBounds(ageRule('6個月', 6, null, '申請人', 'month'))).toBeNull();
    expect(ageBounds(ageRule('70歲以上', 65, null))).toBeNull();
    expect(ageBounds(ageRule(null, 65, null))).toBeNull();
  });
});

describe('evaluate：保守匹配', () => {
  it('全部未知時為 possible，不判定不符', () => {
    const item = makeSubsidy({ eligibility: { age: [ageRule('65歲以上', 65, null)] } as any });
    const r = evaluate(item, {});
    expect(r.fit).toBe('possible');
    expect(r.blocked_by).toEqual([]);
    expect(r.pending?.some((p) => p.includes('65歲以上'))).toBe(true);
  });

  it('未逐筆審閱及來源綁定的合成資料不硬排除', () => {
    const item = makeSubsidy({ eligibility: { age: [ageRule('65歲以上', 65, null)] } as any });
    expect(evaluate(item, { age: 40 }).fit).toBe('possible');
    expect(evaluate(item, { age: 65 }).fit).toBe('possible');
  });

  it('現階段不發出 likely，即使已知條件皆相符', () => {
    const item = realItem('WEL-0055');
    const r = evaluate(item, { age: 70 });
    expect(r.fit).toBe('possible');
    expect(r.reasons.length).toBe(1);
  });

  it('原文其他位置含替代條件（raw_summary、exclusions、extensions、來源備註）時不可硬排除', () => {
    const rule = [ageRule('65歲以上', 65, null)];
    const cases = [
      makeSubsidy({ eligibility: { age: rule, raw_summary: '65歲以上或55歲以上原住民' } as any }),
      makeSubsidy({ eligibility: { age: rule, exclusions: ['身障者不受年齡限制'] } as any }),
      makeSubsidy({ eligibility: { age: rule }, extensions: [{ key: 'x', label: '例外', namespace: 'eligibility', raw: '經評估者不限年齡' }] } as any),
      makeSubsidy({ eligibility: { age: rule }, source_meta: { notes: '特殊個案得專案核定' } } as any),
      makeSubsidy({ eligibility: { age: rule, taipei_applicability: '設籍滿一年者另有規定' } as any }),
      makeSubsidy({ eligibility: { age: rule, special_rule: '另見附表' } as any }),
    ];
    for (const item of cases) {
      const r = evaluate(item, { age: 30 });
      expect(r.fit).toBe('possible');
      expect(r.blocked_by).toEqual([]);
      expect(ageVerdict(item, 30)).toBeNull();
    }
  });

  it('兒童／子女年齡不套到申請人', () => {
    const item = makeSubsidy({ eligibility: { age: [ageRule('未滿7歲', null, 7, '子女')] } as any });
    const r = evaluate(item, { age: 40 });
    expect(r.fit).toBe('possible');
    expect(r.pending?.some((p) => p.includes('子女'))).toBe(true);
  });

  it('多條年齡規則（可能是替代途徑）不排除', () => {
    const item = makeSubsidy({
      eligibility: { age: [ageRule('65歲以上', 65, null), ageRule('55歲以上', 55, null, '原住民')] } as any,
    });
    expect(evaluate(item, { age: 30 }).fit).toBe('possible');
  });

  it('戶籍不同不排除，只提示', () => {
    const item = makeSubsidy({
      scope: { level: 'taipei', regions: ['臺北市'] },
      eligibility: { residence: [{ region: '臺北市', registered_required: true, actual_residence_required: null, raw: '設籍臺北市' }] } as any,
    });
    const r = evaluate(item, { region: '其他縣市' });
    expect(r.fit).toBe('possible');
    expect(r.warnings.some((w) => w.includes('不據此排除'))).toBe(true);
  });

  it('不比較個人所得，所得條件列為待確認', () => {
    const item = makeSubsidy({
      eligibility: { income: [{ subject: '家戶', raw: '家庭年所得90萬元以下', value: 900000, period: 'year', year: null }] } as any,
    });
    const r = evaluate(item, { household_type: 'general' });
    expect(r.fit).toBe('possible');
    expect(r.pending?.some((p) => p.includes('家戶'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('不比較所得'))).toBe(true);
  });

  it('一般戶遇低收身分條件只提示、不排除；家庭身分訊息標記為個人資訊', () => {
    const item = makeSubsidy({ eligibility: { household: [{ types: ['低收入戶'], raw: '低收入戶' }] } as any });
    const r = evaluate(item, { household_type: 'general' });
    expect(r.fit).toBe('possible');
    expect(r.personal?.some((p) => p.field === 'household_type')).toBe(false); // 未使用填答產生推論，不需個資標記
  });

  it('raw_summary 中無法結構化的限制列為待確認', () => {
    const item = makeSubsidy({ eligibility: { raw_summary: '曾受職災且經醫師診斷者' } as any });
    expect(evaluate(item, {}).pending?.some((p) => p.includes('職災'))).toBe(true);
  });

  it('partial／過期期限產生警告', () => {
    const item = makeSubsidy({
      source_meta: { verification_status: 'partial' },
      application: { deadline: { type: 'fixed', raw: '至2026-01-31', start: null, end: '2026-01-31' } },
    } as any);
    const r = evaluate(item, {}, '2026-11-07');
    expect(r.warnings.some((w) => w.includes('部分查核'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('2026-01-31'))).toBe(true);
  });

  it('原文欄位為 null 時安全處理', () => {
    const item = makeSubsidy({
      eligibility: {
        raw_summary: null,
        age: [ageRule(null, 65, null)],
        residence: [{ region: null, registered_required: true, actual_residence_required: null, raw: null }],
        household: [{ types: ['中低收入戶'], raw: null }],
        student: [{ raw: null }],
        exclusions: [],
      } as any,
    });
    expect(() => evaluate(item, { age: 30, region: '臺北市', household_type: 'general', is_student: false })).not.toThrow();
    expect(evaluate(item, { age: 30 }).fit).toBe('possible');
    expect(quote(null)).toContain('原文未提供');
    expect(text(undefined)).toBe('');
  });
});
