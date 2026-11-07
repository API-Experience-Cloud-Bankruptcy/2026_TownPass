import { describe, expect, it } from 'vitest';
import { buildLocalQuestions, parseNumberAnswer, questionsFor, sanitizeQuestions, setAnswer, titleFor } from '../questions';
import { ageRule, makeSubsidy } from './fixtures';

const items = [
  makeSubsidy({ id: 'A', eligibility: { age: [ageRule('65歲以上', 65, null)] } as any }),
  makeSubsidy({
    id: 'B',
    eligibility: { residence: [{ region: '臺北市', registered_required: true, actual_residence_required: null, raw: '設籍臺北市' }] } as any,
  }),
  makeSubsidy({ id: 'C', eligibility: { student: [{ raw: '在學' }] } as any }),
  // 只有 facet 標學生、scope 為臺北市，不應加題
  makeSubsidy({ id: 'D', scope: { level: 'taipei', regions: ['臺北市'] }, search: { facets: { applicant_types: ['學生'] } } } as any),
];

describe('本機固定題庫', () => {
  const bank = buildLocalQuestions(items);
  it('依資料條件出題，不因 scope／facet 加題', () => {
    const byField = Object.fromEntries(bank.map((q) => [q.field, q.resource_ids]));
    expect(byField.age).toEqual(['A']);
    expect(byField.region).toEqual(['B']);
    expect(byField.is_student).toEqual(['C']);
    expect(byField.household_type).toBeUndefined();
  });
  it('戶籍選項為繁中縣市字串加其他縣市', () => {
    const region = bank.find((q) => q.field === 'region')!;
    expect(region.options?.map((o) => o.value)).toEqual(['臺北市', '其他縣市']);
  });
  it('依候選資源篩題', () => {
    expect(questionsFor(bank, ['A']).map((q) => q.field)).toEqual(['age']);
    expect(questionsFor(bank, ['D'])).toEqual([]);
  });
  it('本人與他人問句不同', () => {
    const age = bank.find((q) => q.field === 'age')!;
    expect(titleFor(age, 'self')).toContain('你');
    expect(titleFor(age, 'other')).toContain('對方');
  });
});

describe('答案', () => {
  const [age] = buildLocalQuestions(items).filter((q) => q.field === 'age');
  const region = buildLocalQuestions(items).find((q) => q.field === 'region')!;
  it('不知道會移除答案，不存成否定值', () => {
    const a = setAnswer({}, age, 70);
    expect(a.age).toBe(70);
    expect(setAnswer(a, age, undefined).age).toBeUndefined();
  });
  it('超出範圍的年齡不保存；上限為 130', () => {
    expect(setAnswer({}, age, 131).age).toBeUndefined();
    expect(setAnswer({}, age, 130).age).toBe(130);
  });
  it('戶籍保留原始選項字串', () => {
    expect(setAnswer({}, region, '新北市').region).toBe('新北市');
  });
});

describe('API 題目驗證', () => {
  it('丟棄格式錯誤的題目', () => {
    const qs = sanitizeQuestions({
      questions: [
        { id: 'age', field: 'age', kind: 'number', title: '幾歲', min: 0, max: 130, resource_ids: ['A'] },
        { id: 'bad', field: 'x', kind: 'llm', title: '?', resource_ids: [] },
        { id: 'noopt', field: 'is_student', kind: 'boolean', title: '在學？', resource_ids: ['C'] },
        { id: 'ids', field: 'region', kind: 'single', title: '戶籍', options: [{ label: '臺北市', value: '臺北市' }], resource_ids: [1] },
      ],
    });
    expect(qs.map((q) => q.id)).toEqual(['age']);
    expect(sanitizeQuestions(null)).toEqual([]);
  });
});

describe('數字題輸入（v-model type=number 可能給 number）', () => {
  it('number 與字串都可解析', () => {
    expect(parseNumberAnswer(72)).toEqual({ ok: true, value: 72 });
    expect(parseNumberAnswer(' 72 ')).toEqual({ ok: true, value: 72 });
  });
  it('空值、NaN、小數、超出範圍回傳錯誤而不拋例外', () => {
    for (const bad of ['', NaN, 72.5, -1, 131, 'abc', null, undefined]) {
      const r = parseNumberAnswer(bad, 0, 130);
      expect(r.ok).toBe(false);
    }
  });
});
