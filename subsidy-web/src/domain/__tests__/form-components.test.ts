// 元件冒煙測試：用 Vue 伺服器端渲染檢查畫面與隱私規則（專案沒有 DOM 測試工具）。
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { describe, expect, it } from 'vitest';
import FormFillPanel from '../../components/FormFillPanel.vue';
import FormResourcesPanel from '../../components/FormResourcesPanel.vue';
import { realItem } from './real-data';
import type { Target } from '../types';

const render = (component: object, props: Record<string, unknown>) => renderToString(createSSRApp(component, props));
const panel = (id: string, target: Target | null) => render(FormFillPanel, { item: realItem(id), target });

describe('FormFillPanel', () => {
  it('替本人申請：只有一顆一鍵填寫按鈕與親簽提醒，不預先讀取或顯示個資', async () => {
    const html = await panel('WEL-0067', 'self');
    expect(html).toContain('帶入資料，產生申請表');
    expect(html).toContain('本人親筆簽名');
    expect(html).toContain('開啟空白表單');
    expect(html).not.toContain('class="input"');
    expect(html).not.toContain('type="checkbox"');
  });
  it('替他人或未選：沒有一鍵填寫，也不能產生填好的檔案', async () => {
    for (const target of ['other', null] as const) {
      const html = await panel('WEL-0067', target);
      expect(html).toContain('目前不是替自己申請');
      expect(html).not.toContain('帶入資料，產生申請表');
    }
  });
  it('不能填寫的表單：說明原因並給官方入口，不出現填寫流程', async () => {
    const online = await panel('WEL-0059', 'self');
    expect(online).not.toContain('帶入資料，產生申請表');
    expect(online).toMatch(/線上|沒有可用的申請表|不能自動填寫/);
  });
  it('每一筆資料都能渲染，不丟例外', async () => {
    const ids = ['WEL-0001', 'WEL-0010', 'WEL-0028', 'WEL-0059', 'WEL-0074', 'WEL-0099', 'WEL-0106', 'WEL-0127', 'CT-0125', 'CT-0127'];
    for (const id of ids) expect((await panel(id, 'self')).length).toBeGreaterThan(50);
  });
});


 describe('FormResourcesPanel', () => {
  it('先列原始檔案，使用者選擇填寫前不載入個資或產生 PDF', async () => {
    const html = await render(FormResourcesPanel, { item: realItem('WEL-0067'), target: 'self' });
    expect(html).toContain('開啟／下載原始檔案');
    expect(html).toContain('填寫這份表單');
    expect(html).not.toContain('帶入資料，產生申請表');
  });
  it('替他人仍可下載，但不提供自動帶入入口', async () => {
    const html = await render(FormResourcesPanel, { item: realItem('WEL-0067'), target: 'other' });
    expect(html).toContain('開啟／下載原始檔案');
    expect(html).not.toContain('填寫這份表單');
  });
  it('未收錄檔案不宣稱免附文件', async () => {
    const html = await render(FormResourcesPanel, { item: realItem('WEL-0002'), target: 'self' });
    expect(html).toContain('不代表免附文件');
  });
});
