import { describe, expect, it } from 'vitest';
import { NEED_ALIASES, routeInput } from '../input-router';
import { SITUATIONS } from '../../domain/situations';
import type { InterpretationContext } from '../interpretation';
import { makeSubsidy } from '../../domain/__tests__/fixtures';

const context = (target: 'self' | 'other', stage: 'needs' | 'search' = 'needs'): InterpretationContext => ({
  stage, target, choices: [{ id: 'explore', label: '還不確定，帶我找' }, ...SITUATIONS.map(s => ({ id: `need:${s.id}`, label: s.label }))],
  situations: SITUATIONS, allowedFacts: [],
});
const catalog = [makeSubsidy({ name: '學費補助' })];

describe.each(['self', 'other'] as const)('%s 的文字與需求按鈕一致', target => {
  for (const stage of ['needs', 'search'] as const) {
    for (const [index, situation] of SITUATIONS.entries()) {
      it.each([situation.label, ...(NEED_ALIASES[situation.id] ?? []), `選${index + 2}`])(`${stage}：%s`, input => {
        expect(routeInput(input, context(target, stage), catalog)).toMatchObject({ kind: 'answer', answer: { choiceId: `need:${situation.id}` } });
      });
    }
  }
  it.each(['我不要學費', '學費？', '“學費”', '學費或租屋', '不是學生', '65？', '學費、租屋'])('不把不確定或複合輸入 %s 當答案', input => {
    expect(routeInput(input, context(target), catalog).kind).not.toBe('answer');
  });
  it('指定搜尋仍依查詢字詞搜尋', () => {
    expect(routeInput('搜尋 學費', context(target), catalog)).toEqual({ kind: 'search', query: '學費' });
  });
  it('目前問題沒有需求按鈕時不以需求別名作答', () => {
    expect(routeInput('學費', { ...context(target), stage: 'questions', choices: [{ id: 'skip', label: '不知道，先跳過' }] }, catalog)).toEqual({ kind: 'search', query: '學費' });
  });
});

it.each(['返回', '上一步', '重新開始', '重來', '取消', '幫助', '使用說明'])('沒有背景選項時仍辨識命令 %s', input => {
  expect(routeInput(input, { ...context('self'), choices: [] }, []).kind).toBe('command');
});
it.each(['“是”', '‘是’', '「是」', '是？'])('引述或詢問不採用布林答案 %s', input => {
  const c = context('self');
  c.choices = [{ id: 'option:0', label: '是' }, { id: 'option:1', label: '否' }];
  c.question = { id: 'student', field: 'is_student', title: '在學？', kind: 'boolean', options: c.choices };
  expect(routeInput(input, c, []).kind).not.toBe('answer');
});
it.each(['6.5', '-1', '20/2', '999', '一百二', '65？', '“65”'])('不將不合法年齡 %s 寫入', input => {
  const c = context('self');
  c.choices = [{ id: 'skip', label: '不知道，先跳過' }];
  c.question = { id: 'age', field: 'age', title: '年齡？', kind: 'number', min: 0, max: 130, options: [] };
  expect(routeInput(input, c, []).kind).not.toBe('answer');
});
it.each(['６５', '六十五歲', '65'])('合法年齡 %s 可直接作答', input => {
  const c = context('self');
  c.choices = [];
  c.question = { id: 'age', field: 'age', title: '年齡？', kind: 'number', min: 0, max: 130, options: [] };
  expect(routeInput(input, c, [])).toMatchObject({ kind: 'answer', answer: { numberValue: 65 } });
});
