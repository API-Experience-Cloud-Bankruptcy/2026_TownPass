import { realItem } from './real-data';
import { describe, expect, it } from 'vitest';
import { buildLocalQuestions, descriptionFor, parseNumberAnswer, questionsFor, sanitizeQuestions, setAnswer, titleFor } from '../questions';
import { questionTemplates } from '../adaptive';
import { makeSubsidy } from './fixtures';

const items = [realItem('WEL-0055'), realItem('WEL-0089'), realItem('WEL-0110'),
  makeSubsidy({id:'D',scope:{level:'taipei',regions:['臺北市']},search:{facets:{applicant_types:['學生']}}} as any)];

describe('本機固定題庫', () => {
  const bank = buildLocalQuestions(items);
  it('依資料條件出題，不因 scope／facet 加題', () => {
    const byField = Object.fromEntries(bank.map((q) => [q.field, q.resource_ids]));
    expect(byField.age).toEqual(['WEL-0055','WEL-0089','WEL-0110']);
    expect(byField.region).toEqual(['WEL-0089']);
    expect(byField.is_student).toEqual(['WEL-0110']);
    expect(byField.household_type).toEqual(['WEL-0089']);
  });
  it('戶籍選項為繁中縣市字串加其他縣市', () => {
    const region = bank.find((q) => q.field === 'region')!;
    expect(region.options?.map((o) => o.value)).toEqual(['臺北市', '其他縣市']);
  });
  it('依候選資源篩題', () => {
    expect(questionsFor(bank, ['WEL-0055']).some(q=>q.field==='age')).toBe(true);
    expect(questionsFor(bank,['WEL-0055']).some(q=>q.field==='need_area')).toBe(true);
    expect(questionsFor(bank, ['D'])).toEqual([]);
  });
  it('本人與他人問句不同', () => {
    const age = bank.find((q) => q.field === 'age')!;
    expect(titleFor(age, 'self')).toContain('你');
    expect(titleFor(age, 'other')).toContain('對方');
  });
  it('所有對象條件與探索題在幫別人模式都明確指向對方，保留法定條件', () => {
    const fields = ['age', 'region', 'is_student', 'household_type', 'has_farmer_insurance', 'veteran_status', 'owns_home', 'is_renting', 'is_unemployed', 'disability_certificate', 'explore_context', 'employment_status', 'housing_status', 'expense_priority'];
    for (const field of fields) {
      const question = questionTemplates.find(q => q.field === field)!;
      expect(titleFor(question, 'other'), field).toContain('對方');
      expect(titleFor(question, 'other'), field).not.toMatch(/你|本人/);
      expect(descriptionFor(question, 'other'), field).not.toMatch(/你|本人/);
      expect(titleFor(question, 'self'), field).toContain('你');
    }
    expect(titleFor(questionTemplates.find(q => q.field === 'veteran_status')!, 'other')).toContain('輔導條例第2條');
    expect(titleFor(questionTemplates.find(q => q.field === 'owns_home')!, 'other')).toContain('住宅');
    expect(descriptionFor(questionTemplates.find(q => q.field === 'household_type')!, 'other')).toContain('政府核定');
  });
  it('API 與本機題庫共用呈現，不改動原始題目或未知欄位', () => {
    const source = { id: 'api-age', field: 'age', kind: 'number' as const, title: '原本的年齡題目', description: '原始提示', resource_ids: ['A'] };
    const [api] = sanitizeQuestions({ questions: [source] });
    expect(titleFor(api!, 'other')).toBe('對方目前幾歲（實歲）？');
    expect(descriptionFor(api!, 'other')).toContain('對方目前已滿的歲數');
    expect(api!.title).toBe(source.title);
    expect(titleFor({ ...source, field: 'future_field' }, 'other')).toBe(source.title);
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
