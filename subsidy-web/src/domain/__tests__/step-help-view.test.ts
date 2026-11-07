import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import StepHelpView from '../../components/StepHelpView.vue';
import { state } from '../../store';
import { loadSnapshot } from '../catalog';
import { emptySession } from '../session';
import { buildRoute } from '../route';
import { stepGuideFor } from '../step-guide';

describe('步驟協助頁', () => {
  it('進頁直接呈現客製動作，不需要先選困難；保留相關文件與返回入口', async () => {
    state.catalog = { ...await loadSnapshot(), origin: 'snapshot', sourceLabel: 'test' };
    const item = state.catalog.items.find(item => item.id === 'WEL-0002')!;
    const step = buildRoute(item).steps[0]!;
    const guide = stepGuideFor(item, step)!;
    state.personalPlan = emptySession('self');
    state.personalPlan.planIds = [item.id];
    state.planItemId = item.id;
    state.helpStep = step;
    const html = await renderToString(createSSRApp(StepHelpView));
    expect(html).toContain('id="view-title"');
    expect(html).toContain(guide.title);
    for (const action of guide.actions) expect(html).toContain(action);
    expect(html).toContain('回到這一步，繼續準備');
    expect(html).toContain('複製詢問文字');
    expect(html).not.toContain('完整流程：');
    expect(html).not.toContain('適用對象：');
    expect(state.personalPlan.stepDone).toEqual({});
  });
  it('失效步驟不顯示其他方案教學', async () => {
    state.helpStep = '不存在的步驟';
    const html = await renderToString(createSSRApp(StepHelpView));
    expect(html).toContain('這個步驟已變更');
    expect(html).not.toContain('複製詢問文字');
  });
});
