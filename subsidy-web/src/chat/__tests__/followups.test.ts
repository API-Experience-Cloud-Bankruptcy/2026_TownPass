import { describe, expect, it } from 'vitest';
import { matchFollowupChoice, planFollowups, type FollowupInput } from '../followups';
import type { CandidateFact } from '../interpretation';

const lowIncome: CandidateFact = { field: 'household_type', value: 'low_income', subject: 'self', subjectLabel: '我', evidence: '我是低收入戶' };
const input = (over: Partial<FollowupInput> = {}, facts: CandidateFact[] = [lowIncome], situationIds = ['living']): FollowupInput => ({
  result: { kind: 'situation', situationIds, facts, details: [], uncertainties: [] },
  target: null, currentSituation: null,
  describe: f => `${f.field}=${String(f.value)}`, situationLabel: id => `#${id}`, ...over,
});

describe('一句話拆成逐題追問', () => {
  it('「我是低收入戶」：先問對象，再問條件，再問方向，全部答完才有結果', () => {
    let plan = planFollowups(input(), {});
    expect(plan.current?.id).toBe('target');
    expect(plan.current?.prompt).toContain('自己');
    expect(plan.outcome).toBeNull();
    plan = planFollowups(input(), { target: 'target:self' });
    expect(plan.current?.id).toBe('fact:household_type');
    expect(plan.steps).toHaveLength(2);
    plan = planFollowups(input(), { target: 'target:self', 'fact:household_type': 'yes' });
    expect(plan.current?.id).toBe('situation');
    plan = planFollowups(input(), { target: 'target:self', 'fact:household_type': 'yes', situation: 'yes' });
    expect(plan.current).toBeNull();
    expect(plan.outcome).toEqual({ target: 'self', facts: [lowIncome], situation: 'living', skipped: [] });
  });

  it('改成幫別人找時，本人的條件不會套用，也不再追問', () => {
    const plan = planFollowups(input(), { target: 'target:other', situation: 'no' });
    expect(plan.steps.map(s => s.id)).toEqual(['target', 'situation']);
    expect(plan.outcome?.facts).toEqual([]);
    expect(plan.outcome?.skipped[0]).toContain('不是這次查詢對象');
  });

  it('對象已知時不重問；目前方向不重問', () => {
    const plan = planFollowups(input({ target: 'self', currentSituation: 'living' }), { 'fact:household_type': 'no' });
    expect(plan.steps.map(s => s.id)).toEqual(['fact:household_type']);
    expect(plan.outcome).toMatchObject({ facts: [], situation: null });
  });

  it('不明主體逐筆問；多位只查一位；同欄位不同說法讓本人選', () => {
    const facts: CandidateFact[] = [
      { field: 'age', value: 70, subject: 'other', subjectLabel: '媽媽', evidence: '媽媽70歲' },
      { field: 'age', value: 72, subject: 'other', subjectLabel: '爸爸', evidence: '爸爸72歲' },
      { field: 'region', value: '臺北市', subject: 'unclear', subjectLabel: '', evidence: '戶籍在臺北' },
    ];
    const base = input({ target: 'other' }, facts, []);
    expect(planFollowups(base, {}).current?.id).toBe('who:2');
    expect(planFollowups(base, { 'who:2': 'yes' }).current?.id).toBe('person');
    const plan = planFollowups(base, { 'who:2': 'yes', person: 'person:0' });
    expect(plan.current?.id).toBe('fact:age');
    const done = planFollowups(base, { 'who:2': 'yes', person: 'person:0', 'fact:age': 'yes' });
    expect(done.outcome?.facts.map(f => f.value)).toEqual([70]);
    expect(done.outcome?.skipped.join()).toContain('爸爸');

    const conflict = input({ target: 'self' }, [{ ...lowIncome }, { ...lowIncome, value: 'mid_low_income', evidence: '中低收入戶' }], []);
    const step = planFollowups(conflict, {}).current!;
    expect(step.choices.map(c => c.id)).toEqual(['value:0', 'value:1', 'no']);
    expect(planFollowups(conflict, { 'fact:household_type': 'value:1' }).outcome?.facts[0]?.value).toBe('mid_low_income');
  });

  it('幫家人確認條件時，問句與歷史步驟都標明對方', () => {
    const fact: CandidateFact = { field: 'age', value: 70, subject: 'other', subjectLabel: '媽媽', evidence: '媽媽70歲' };
    const base = input({ target: 'other' }, [fact], []);
    const current = planFollowups(base, {}).current!;
    expect(current.prompt).toContain('對方的情況');
    expect(current.prompt).not.toContain('你的情況');
    const done = planFollowups(base, { 'fact:age': 'yes' });
    expect(done.steps[0]!.prompt).toBe(current.prompt);
    expect(done.outcome?.facts).toEqual([fact]);
  });

  it('多個方向用單選題，可以先不選', () => {
    const plan = planFollowups(input({ target: 'self' }, [], ['living', 'housing']), {});
    expect(plan.current?.choices.map(c => c.id)).toEqual(['situation:living', 'situation:housing', 'no']);
    expect(planFollowups(input({ target: 'self' }, [], ['living', 'housing']), { situation: 'situation:housing' }).outcome?.situation).toBe('housing');
  });
});

describe('打字回答目前這一題', () => {
  const yesNo = planFollowups(input({ target: 'self' }), {}).current!;
  const target = planFollowups(input(), {}).current!;
  it('接受是非、完整選項、對象別稱與序號', () => {
    expect(matchFollowupChoice('對', yesNo)).toBe('yes');
    expect(matchFollowupChoice('不要', yesNo)).toBe('no');
    expect(matchFollowupChoice('對，記下來', yesNo)).toBe('yes');
    expect(matchFollowupChoice('自己', target)).toBe('target:self');
    expect(matchFollowupChoice('第二個', target)).toBe('target:other');
  });
  it('問句或無關的話不猜', () => {
    expect(matchFollowupChoice('這是什麼意思？', yesNo)).toBeNull();
    expect(matchFollowupChoice('我想找房租補助', yesNo)).toBeNull();
  });
});
