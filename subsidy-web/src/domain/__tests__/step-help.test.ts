import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import StepHelp from '../../components/StepHelp.vue';
import { buildStepHelp } from '../step-help';
import { stepGuideFor, stepGuides } from '../step-guide';
import { buildRoute } from '../route';
import { loadSnapshot } from '../catalog';
import { makeSubsidy } from './fixtures';

describe('目前步驟的處理協助', () => {
  it('依步驟排序而不是以整個方案判定問題，拒絕其他步驟', () => {
    const item = makeSubsidy({ application: { process_text: '註冊並登入→上傳附件→等待審核通知' } });
    expect(buildStepHelp(item, '註冊並登入')?.suggested[0]?.id).toBe('login');
    expect(buildStepHelp(item, '上傳附件')?.suggested.map(p => p.id)).toContain('upload');
    const help = buildStepHelp(item, '等待審核通知')!;
    expect(help.suggested.map(p => p.id)).toEqual(['status']);
    expect(help.askText(help.suggested[0]!)).toContain('第 3 步「等待審核通知」');
    expect(buildStepHelp(item, '其他方案步驟')).toBeNull();
  });
  it('缺資料不補造窗口、網址或免附文件；仍提供問題與下一步', () => {
    const item = makeSubsidy({ provider: { name: '' }, application: { agency: '', channel_text: '', process_text: '辦理', required_documents: [], urls: { program: 'javascript:alert(1)' } }, source_meta: { sources: [] } });
    const help = buildStepHelp(item, '辦理')!;
    expect(help.suggested[0]?.id).toBe('understand');
    expect(help.route.links).toEqual([]);
    expect(help.route.channel).toBe('');
    expect(help.route.missing.join('')).toContain('不代表免附');
    expect(help.others.length).toBeGreaterThan(0);
  });
  it('保留地方文件條件及流程例外，不把方案方式當成步驟許可', () => {
    const item = makeSubsidy({ application: { process_text: '本人簽名不得代簽→可郵寄送件', methods: ['mail'], required_documents: [{ name: '地方證明', regions: ['臺中市'], region_basis: 'residence', condition: '特定對象', notes: '附正本', required: true }] } });
    const help = buildStepHelp(item, '本人簽名不得代簽')!;
    expect(help.process).toContain('不得代簽');
    expect(help.suggested[0]?.id).toBe('consent');
    expect(help.route.pendingDocuments[0]).toMatchObject({ regions: ['臺中市'], condition: '特定對象', notes: '附正本' });
  });
  it('所有收錄方案每一步均可產生自身的問題、問句與來源', async () => {
    const { items } = await loadSnapshot();
    for (const item of items) {
      const route = buildRoute(item);
      for (const step of route.steps) {
        const help = buildStepHelp(item, step)!;
        expect(help.itemId).toBe(item.id);
        expect(help.route.sources).toEqual(route.sources);
        const options = [...help.suggested, ...help.others];
        expect(new Set(options.map(p => p.id)).size).toBe(options.length);
        for (const problem of options) {
          expect(help.askText(problem)).toContain(item.name);
          expect(help.askText(problem)).toContain(step);
          expect(problem.action.length).toBeGreaterThan(0);
        }
      }
    }
  });
  it('入口使用可操作的按鈕並且失效步驟不顯示入口', async () => {
    const item = makeSubsidy();
    const html = await renderToString(createSSRApp(StepHelp, { item, step: '準備文件' }));
    expect(html).toContain('這一步做不到');
    expect(html).toContain('開啟步驟協助頁');
    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain('這一步卡在哪裡');
    expect(await renderToString(createSSRApp(StepHelp, { item, step: '不存在' }))).not.toContain('這一步做不到');
  });
  it('每個收錄方案的專屬教學對應所有原文步驟，文件只能引用該方案資料', async () => {
    const { items } = await loadSnapshot();
    expect(Object.keys(stepGuides).sort()).toEqual(items.map(item => item.id).sort());
    for (const item of items) {
      const route = buildRoute(item);
      const entry = stepGuides[item.id]!;
      expect(entry.process, item.id).toBe(item.application.process_text);
      expect(entry.steps.map(g => g.step), item.id).toEqual(route.steps);
      for (const step of route.steps) {
        const guide = stepGuideFor(item, step);
        expect(guide, `${item.id}: ${step}`).not.toBeNull();
        expect(guide!.actions.length).toBeGreaterThanOrEqual(2);
        expect(guide!.actions.every(action => action.trim().length > 10)).toBe(true);
        for (const name of guide!.documentNames) {
          expect(item.application.required_documents.some(doc => doc.name === name), `${item.id}: ${name}`).toBe(true);
        }
        const help = buildStepHelp(item, step)!;
        expect(help.documents.every(doc => guide!.documentNames.includes(doc.name))).toBe(true);
        if (help.primaryLink) expect(route.links).toContainEqual(help.primaryLink);
      }
    }
  });
  it('來源、文件或流程更新後，不沿用舊的客製教學', async () => {
    const { items } = await loadSnapshot();
    const item = items.find(item => buildRoute(item).steps.length)!;
    const step = buildRoute(item).steps[0]!;
    expect(stepGuideFor(item, step)).not.toBeNull();
    const changed = JSON.parse(JSON.stringify(item));
    changed.application.channel_text = '更新後的窗口';
    expect(stepGuideFor(changed, step)).toBeNull();
    expect(buildStepHelp(changed, step)?.documents).toEqual([]);
    expect(stepGuideFor(item, '不存在的步驟')).toBeNull();
  });

  it('無流程方案提供確認方向，不憑空建立完成步驟', async () => {
    const { items } = await loadSnapshot();
    for (const item of items.filter(item => !buildRoute(item).steps.length)) {
      const help = buildStepHelp(item, '')!;
      expect(help.stepNumber).toBe(0);
      expect(help.route.steps).toEqual([]);
      expect(help.guide?.actions.length).toBeGreaterThanOrEqual(2);
      expect(help.askText(help.suggested[0]!)).toContain('找不到完整辦理流程');
    }
  });

});
