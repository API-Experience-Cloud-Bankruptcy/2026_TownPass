// Issues #60 and #61: identity prerequisites and single-choice questions in the elder allowance flow.
import { beforeEach, describe, expect, it } from 'vitest';
import { realItems } from '../domain/__tests__/real-data';
import { buildLocalQuestions, setAnswer, withIdentitySupport } from '../domain/questions';
import {
  answerAndAdvance, focusedCandidates, go, otherCandidates, questions, recommendedCandidates, requestTarget, resetPerson, results, selectNeed, state,
} from '../store';

const GATED = ['CT-0034', 'CT-0099', 'CT-0104'];
const ids = () => recommendedCandidates.value.map(i => i.id);

/** 幫家人找 → 長者與照顧 → 日常生活津貼或年金 → 78 歲. */
function elderAllowance78(): void {
  resetPerson(null);
  state.loading = false;
  state.catalog = { version: 'real', origin: 'snapshot', sourceLabel: 'real', items: realItems };
  state.bank = { version: 'real', origin: 'local', questions: withIdentitySupport(buildLocalQuestions(realItems), realItems) };
  requestTarget('other');
  selectNeed('elder');
  let q = questions.value[state.qIndex];
  expect(q.field).toBe('elder_support');
  expect(answerAndAdvance(q.id, 'allowance', 1000)).toBe(true);
  q = questions.value[state.qIndex];
  expect(q.field).toBe('age');
  expect(answerAndAdvance(q.id, 78, 2000)).toBe(true);
}
function answerLater(field: string, value: string): void {
  const q = state.bank!.questions.find(x => x.field === field)!;
  state.session.answers = setAnswer(state.session.answers, q, value);
}

beforeEach(elderAllowance78);

describe('#60 身分限定方案在身分未回答時排在後面', () => {
  it('78 歲先看結果：不需特殊身分的方案排在老農、榮民、中低收入之前', () => {
    go('results');
    expect(ids()).toEqual(['CT-0067', ...GATED]);
  });
  it('剩餘結果依身分分歧時下一題問身分，且可答「都不是」', () => {
    const next = questions.value[state.qIndex];
    expect(next.field).toBe('special_identity');
    expect(next.options?.map(o => o.value)).toEqual(['farmer', 'veteran', 'none']);
    expect(next.options?.find(o => o.value === 'none')?.label).toBe('都不是');
  });
  it('回答中低收入戶後，中低收入老人生活津貼排第一', () => {
    answerLater('household_type', 'mid_low_income');
    go('results');
    expect(ids()).toEqual(['CT-0104', 'CT-0067', 'CT-0034', 'CT-0099']);
  });
  it('回答「一般」不排除中低收入老人生活津貼，只排在不需身分的方案之後', () => {
    answerLater('household_type', 'general');
    go('results');
    expect(ids()).toContain('CT-0104');
    expect(ids().indexOf('CT-0104')).toBeGreaterThan(ids().indexOf('CT-0067'));
    expect(results.value.get('CT-0104')?.fit).toBe('possible');
  });
  it('身分回答「都不是」：老農、榮民移出聚焦結果，仍列在其他資源且不判定不符', () => {
    const q = questions.value[state.qIndex];
    expect(answerAndAdvance(q.id, 'none', 3000)).toBe(true);
    go('results');
    expect(ids()).toEqual(['CT-0067', 'CT-0104']);
    const focused = focusedCandidates.value.map(i => i.id);
    const others = otherCandidates.value.map(i => i.id);
    for (const id of ['CT-0034', 'CT-0099']) {
      expect(focused).not.toContain(id);
      expect(others).toContain(id);
      expect(results.value.get(id)?.fit).toBe('possible');
    }
  });
  it('回答具體身分只提前相符方案，不排除另一種身分的方案', () => {
    const q = questions.value[state.qIndex];
    expect(answerAndAdvance(q.id, 'veteran', 3000)).toBe(true);
    go('results');
    expect(ids()[0]).toBe('CT-0099');
    expect(ids()).toContain('CT-0034');
  });
});

describe('#61 不問只有一個選項或不會改變結果的題目', () => {
  it('78 歲之後不再問只剩「現金補助或津貼」的協助方式題', () => {
    expect(questions.value.slice(state.qIndex).map(q => q.field)).not.toContain('benefit_style');
  });
  it('仍會提出的選擇題都至少有兩個選項', () => {
    for (const q of questions.value.slice(state.qIndex)) if (q.kind !== 'number') expect(q.options?.length, q.field).toBeGreaterThanOrEqual(2);
  });
});
