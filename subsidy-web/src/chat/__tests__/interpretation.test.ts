import { describe, expect, it } from 'vitest';
import { exactAnswer, factApplies, InterpretationTurn, parseInterpretation, type InterpretationContext } from '../interpretation';

const context: InterpretationContext = {
  stage: 'questions', target: 'self', question: { id: 'age', title: '你幾歲？', kind: 'number', min: 0, max: 130, options: [] },
  choices: [{ id: 'skip', label: '不知道，先跳過' }], situations: [{ id: 'housing', label: '住宅與租屋', hint: '租屋' }, { id: 'work', label: '工作與失業', hint: '工作' }],
  allowedFacts: [{ field: 'age', min: 0, max: 130 }, { field: 'region', options: [{ label: '臺北市', value: '臺北市' }, { label: '其他縣市', value: '其他縣市' }] }, { field: 'household_type', options: [{ label: '低收入戶', value: 'low_income' }, { label: '一般', value: 'general' }] }],
};
const parse = (raw: object, input = '我今年65歲') => parseInterpretation({ requestId: 'one', ...raw }, 'one', input, context);
const age = { field: 'age' as const, value: 65, subject: 'self', subjectLabel: '我', evidence: '我今年65歲' };
const situation = (facts: unknown[] = [], details: string[] = []) => ({ kind: 'situation', situationIds: ['housing'], facts, details, uncertainties: [] });

describe('目前答案與需求界線', () => {
  it('單一有效年齡與完整選項可直達；口語必須交模型，不用關鍵字假裝理解', () => {
    expect(exactAnswer('65 歲', context)).toEqual({ kind: 'answer', numberValue: 65, evidence: '65 歲' });
    expect(exactAnswer('我今年65歲', context)).toBeNull();
    expect(exactAnswer('媽媽65歲，我40歲', context)).toBeNull();
    expect(exactAnswer('不知道，先跳過', context)).toMatchObject({ choiceId: 'skip' });
    expect(exactAnswer('999歲', context)).toBeNull();
    expect(exactAnswer('65或60', context)).toBeNull();
    expect(exactAnswer('最近房租繳不出來', context)).toBeNull();
  });
  it('需求分類完整名稱仍提出確認，不直接改需求', () => {
    const needs = { ...context, stage: 'needs' as const, question: undefined, choices: [{ id: 'need:housing', label: '住宅與租屋' }] };
    expect(exactAnswer('住宅與租屋', needs)).toMatchObject({ kind: 'situation', situationIds: ['housing'] });
  });
  it('模型只能選目前動作或合法整數，忽略政策與任意欄位', () => {
    expect(parse({ kind: 'answer', numberValue: 65, evidence: '65歲' })).toMatchObject({ numberValue: 65 });
    expect(() => parse({ kind: 'answer', numberValue: 999, evidence: '我' })).toThrow();
    expect(() => parse({ kind: 'answer', numberValue: 65.5, evidence: '我' })).toThrow();
    expect(() => parse({ kind: 'answer', choiceId: 'approve_all', evidence: '我' })).toThrow();
    expect(() => parse({ kind: 'answer', choiceId: 'skip', evidence: '我', candidateFields: { age: 65 } })).toThrow();
    expect(() => parse({ kind: 'answer', numberValue: 65, evidence: '不存在的證據' })).toThrow();
    expect(() => parse({ kind: 'answer', choiceId: 'skip', numberValue: 65, evidence: '我' })).toThrow();
    expect(() => parseInterpretation({ requestId: 'old', kind: 'clarify' }, 'one', 'test', context)).toThrow();
  });
});

describe('複合敘述與候選事實只供確認', () => {
  it('保留多需求、家庭經濟原文與不確定，不增加未知資格欄位', () => {
    const input = '我今年65歲，失業了，房租付不起，還有兩個孩子';
    const result = parse({ ...situation([age], ['失業了', '房租付不起', '兩個孩子']), situationIds: ['work', 'housing'], uncertainties: ['孩子的情況待確認'] }, input);
    expect(result).toMatchObject({ kind: 'situation', situationIds: ['work', 'housing'], facts: [age], details: ['失業了', '房租付不起', '兩個孩子'] });
    expect(() => parse(situation([{ ...age, field: 'income', value: 0 }]))).toThrow();
    expect(() => parse(situation([], ['編造的家庭情況']))).toThrow();
  });
  it('多人資料顯示明確人物；不明或不符對象不可採用', () => {
    const fact = { ...age, subject: 'other' as const, subjectLabel: '媽媽', evidence: '媽媽65歲' };
    expect(parse(situation([fact]), '我40歲，媽媽65歲')).toMatchObject({ facts: [fact] });
    expect(factApplies(fact, 'self')).toBe(false);
    expect(factApplies(fact, 'other')).toBe(true);
    expect(factApplies({ ...fact, subject: 'unclear' }, 'other')).toBe(false);
    expect(factApplies({ ...fact, subject: 'applicant' }, null)).toBe(false);
    expect(() => parse(situation([{ ...fact, subjectLabel: '爸爸' }]), '媽媽65歲')).toThrow();
  });
  it('居住地與經濟困難不能偷換為戶籍或核定身分', () => {
    expect(() => parse(situation([{ ...age, field: 'region', value: '臺北市', evidence: '我住臺北' }]), '我住臺北')).toThrow();
    expect(parse(situation([{ ...age, field: 'region', value: '其他縣市', evidence: '我戶籍在桃園' }]), '我戶籍在桃園')).toMatchObject({ kind: 'situation' });
    expect(() => parse(situation([{ ...age, field: 'household_type', value: 'low_income', evidence: '我收入變少' }]), '我收入變少')).toThrow();
    expect(() => parse(situation([{ ...age, field: 'household_type', value: 'low_income', evidence: '我沒有低收入戶資格' }]), '我沒有低收入戶資格')).toThrow();
    expect(() => parse(situation([{ ...age, field: 'household_type', value: 'general', evidence: '我沒有低收入戶資格' }]), '我沒有低收入戶資格')).toThrow();
    expect(parse(situation([{ ...age, field: 'household_type', value: 'general', evidence: '我是一般戶' }]), '我是一般戶')).toMatchObject({ kind: 'situation' });
  });
  it('閒聊與澄清無副作用；拒絕混入候選答案', () => {
    expect(parse({ kind: 'off_topic' })).toEqual({ kind: 'off_topic' });
    expect(parse({ kind: 'clarify' })).toEqual({ kind: 'clarify' });
    expect(() => parse({ kind: 'clarify', facts: [age] })).toThrow();
    expect(() => parse(situation(new Array(9).fill(age)))).toThrow();
  });
});

describe('取消與過期非同步結果', () => {
  it('使用者改答案或取消，即使底層忽略 abort 也不可套用結果', async () => {
    const turn = new InterpretationTurn(); let resolve!: (value: string) => void;
    const pending = turn.run('q1', () => 'q1', () => new Promise(r => { resolve = r; }));
    turn.cancel(); resolve('old'); expect(await pending).toBeNull();
    let fingerprint = 'q1';
    const changed = turn.run('q1', () => fingerprint, async () => { fingerprint = 'q2'; return 'late'; });
    expect(await changed).toBeNull();
  });
  it('新一輪不被舊回覆覆蓋；過期錯誤也被丟棄', async () => {
    const turn = new InterpretationTurn(); let resolve!: (value: string) => void;
    const old = turn.run('q', () => 'q', () => new Promise(r => { resolve = r; }));
    const fresh = turn.run('q', () => 'q', async () => 'new'); resolve('old');
    expect(await old).toBeNull(); expect(await fresh).toBe('new');
    await expect(turn.run('q', () => 'q', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
  });
});
