import { beforeEach, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import ResultCard from '../components/ResultCard.vue';
import { makeSubsidy } from '../domain/__tests__/fixtures';
import { emptySession } from '../domain/session';
import { resetPerson, state } from '../store';

const item = makeSubsidy({ id: 'same-resource', name: '同一項補助' });
beforeEach(() => {
  resetPerson(null);
  state.personalPlan = { ...emptySession('self'), planIds: [item.id] };
});

it('本人結果顯示已在行動單；同筆補助的他人結果不顯示本人準備狀態', async () => {
  state.session.target = 'self';
  const own = await renderToString(createSSRApp(ResultCard, { item, result: undefined }));
  expect(own).toContain('已在行動單');
  state.session.target = 'other';
  const other = await renderToString(createSSRApp(ResultCard, { item, result: undefined }));
  expect(other).toContain('同一項補助');
  expect(other).not.toContain('已在行動單');
  expect(other).not.toContain('檢核表');
  expect(state.personalPlan.planIds).toEqual([item.id]);
});
