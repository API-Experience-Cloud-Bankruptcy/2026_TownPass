// 元件冒煙測試：用 Vue 伺服器端渲染檢查畫面與隱私規則（專案沒有 DOM 測試工具）。
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { describe, expect, it } from 'vitest';
import FormFillPanel from '../../components/FormFillPanel.vue';
import FormProfileConfirm from '../../components/FormProfileConfirm.vue';
import { realItem } from './real-data';
import type { Target } from '../types';

const render = (component: object, props: Record<string, unknown>) => renderToString(createSSRApp(component, props));
const panel = (id: string, target: Target | null) => render(FormFillPanel, { item: realItem(id), target });

describe('FormFillPanel', () => {
  it('替本人申請：顯示資料確認與親簽提醒，不預先填任何值', async () => {
    const html = await panel('WEL-0067', 'self');
    expect(html).toContain('確認申請人本人資料');
    expect(html).toContain('從城市通帶入我的資料');
    expect(html).toContain('本人親筆簽名');
    expect(html).toContain('開啟空白表單');
    const textInputs = html.match(/<input[^>]*class="input"[^>]*>/g) ?? [];
    expect(textInputs.length).toBeGreaterThan(0);
    expect(textInputs.every((tag) => !/ value="[^"]+"/.test(tag))).toBe(true);   // 文字輸入框一開始都是空的
  });
  it('替他人或未選：不提供帶入，也不能產生填好的檔案', async () => {
    for (const target of ['other', null] as const) {
      const html = await panel('WEL-0067', target);
      expect(html).toContain('目前不是替自己申請');
      expect(html).not.toContain('從城市通帶入我的資料');
      expect(html).not.toContain('填入已確認的資料');
    }
  });
  it('不能填寫的表單：說明原因並給官方入口，不出現填寫流程', async () => {
    const online = await panel('WEL-0059', 'self');
    expect(online).not.toContain('確認申請人本人資料');
    expect(online).toMatch(/線上|沒有可用的申請表|不能自動填寫/);
  });
  it('每一筆資料都能渲染，不丟例外', async () => {
    const ids = ['WEL-0001', 'WEL-0010', 'WEL-0028', 'WEL-0059', 'WEL-0074', 'WEL-0099', 'WEL-0106', 'WEL-0127', 'CT-0125', 'CT-0127'];
    for (const id of ids) expect((await panel(id, 'self')).length).toBeGreaterThan(50);
  });
});

describe('FormProfileConfirm', () => {
  it('每個欄位都有確認勾選，且沒有值時不可勾選', async () => {
    const html = await render(FormProfileConfirm, { target: 'self' });
    for (const label of ['姓名', '身分證字號', '性別', '手機', '戶籍地址']) expect(html).toContain(`確認這是我本人的${label}`);
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(7);
    expect((html.match(/type="checkbox"[^>]*disabled/g) ?? []).length).toBe(7);
  });
});
