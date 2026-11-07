import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import StepHelp from '../../components/StepHelp.vue';
import { buildStepHelp } from '../step-help';
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
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('這一步卡在哪裡');
    expect(await renderToString(createSSRApp(StepHelp, { item, step: '不存在' }))).not.toContain('這一步做不到');
  });
});
