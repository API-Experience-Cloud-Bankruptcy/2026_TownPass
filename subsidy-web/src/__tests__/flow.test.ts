import { beforeEach, describe, expect, it } from 'vitest';
import { makeSubsidy } from '../domain/__tests__/fixtures';
import {
  answerAndAdvance, back, confirmPending, go, pendingSwitch, questions,
  requestNewPerson, requestTarget, resetPerson, searchResources, selectNeed,
  startQuestions, state, tab,
} from '../store';

beforeEach(() => {
  resetPerson(null);
  pendingSwitch.value = null;
  state.loading = false;
  state.catalog = {
    version: 'test', origin: 'api', sourceLabel: 'test',
    items: [
      makeSubsidy({ id: 'housing', name: '租屋補助', classification: { category: '住宅', benefit_type: '' } }),
      makeSubsidy({ id: 'study', name: '助學金', classification: { category: '教育', benefit_type: '' } }),
    ],
  };
  state.bank = { version: 'test', origin: 'local', questions: [
    { id: 'region', field: 'region', title: '戶籍？', kind: 'single', options: [{ label: '臺北市', value: '臺北市' }], resource_ids: ['housing', 'study'] },
    { id: 'age', field: 'age', title: '年齡？', kind: 'number', resource_ids: ['housing'] },
    { id: 'student', field: 'is_student', title: '在學？', kind: 'boolean', options: [{ label: '是', value: true }], resource_ids: ['study'] },
  ] };
});

describe('逐頁找資源', () => {
  it('對象選擇前進到需求，同一對象返回再選不清除答案', () => {
    requestTarget('self');
    expect(state.view).toBe('needs');
    state.session.answers = { age: 60 };
    tab('home');
    requestTarget('self');
    expect(state.view).toBe('needs');
    expect(state.session.answers.age).toBe(60);
    expect(pendingSwitch.value).toBeNull();
  });

  it('換對象確認前保留資料，確認後清除並前進到需求', () => {
    requestTarget('self');
    state.session.answers = { age: 60 };
    state.session.planIds = ['housing'];
    tab('home');
    requestTarget('other');
    expect(pendingSwitch.value).toBe('other');
    expect(state.view).toBe('home');
    expect(state.session.answers.age).toBe(60);
    confirmPending();
    expect(state.view).toBe('needs');
    expect(state.session.target).toBe('other');
    expect(state.session.answers).toEqual({});
    expect(state.session.planIds).toEqual([]);
    back();
    expect(state.view).toBe('home');
  });

  it('換人按鈕確認後回對象頁，不沿用先前待確認目的頁', () => {
    requestTarget('self');
    state.session.answers = { age: 60 };
    requestTarget('other');
    pendingSwitch.value = null; // 取消對話框
    requestNewPerson();
    confirmPending();
    expect(state.view).toBe('home');
    expect(state.session.answers).toEqual({});
  });

  it('需求清除舊搜尋，搜尋清除舊分類，保留同一人的答案與行動單', () => {
    requestTarget('self');
    state.session.query = '助學金';
    state.session.answers = { age: 60 };
    state.session.planIds = ['housing'];
    selectNeed('housing');
    expect(state.session.query).toBe('');
    expect(state.view).toBe('questions');
    expect(questions.value.map(q => q.id)).toEqual(['region', 'age']);
    back();
    expect(state.view).toBe('needs');
    go('search');
    searchResources(' 助學金 ');
    expect(state.session.situation).toBeNull();
    expect(state.session.query).toBe('助學金');
    expect(questions.value.map(q => q.id)).toEqual(['region', 'student']);
    expect(state.session.answers.age).toBe(60);
    expect(state.session.planIds).toEqual(['housing']);
    back();
    expect(state.view).toBe('search');
  });

  it('逐題返回保留答案；舊題事件和連點不能跳過下一題', () => {
    requestTarget('self');
    selectNeed('housing');
    expect(answerAndAdvance('region', '臺北市', 1000)).toBe(true);
    expect(state.qIndex).toBe(1);
    expect(answerAndAdvance('age', 60, 1100)).toBe(false);
    expect(answerAndAdvance('region', '其他', 2000)).toBe(false);
    expect(state.qIndex).toBe(1);
    back();
    expect(state.qIndex).toBe(0);
    expect(state.session.answers.region).toBe('臺北市');
    expect(answerAndAdvance('region', '臺北市', 2200)).toBe(true);
    expect(answerAndAdvance('age', 60, 2700)).toBe(true);
    expect(state.view).toBe('results');
    startQuestions();
    expect(state.qIndex).toBe(0);
    expect(state.session.answers.age).toBe(60);
    back();
    expect(state.view).toBe('results');
  });

  it('搜尋無結果時直接到結果頁，載入中不開始問答', () => {
    requestTarget('self');
    state.loading = true;
    selectNeed('housing');
    expect(state.view).toBe('needs');
    state.loading = false;
    go('search');
    searchResources('找不到的資源');
    expect(state.view).toBe('results');
    expect(questions.value).toEqual([]);
  });
});
