import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { describe, expect, it } from 'vitest';
import { sourceConditions, sourceParagraphs } from '../source-content';
import { browseCatalog } from '../browse';
import { realItems } from './real-data';
import SourceText from '../../components/SourceText.vue';
import DetailView from '../../components/DetailView.vue';
import BrowseView from '../../components/BrowseView.vue';
import ResultCard from '../../components/ResultCard.vue';
import { plainLanguageFor } from '../plain-language';
import { state } from '../../store';

const render = (component: object, props: Record<string, unknown> = {}) => renderToString(createSSRApp(component, props));
function loadCatalog() {
  state.catalog = { version: 'test', items: realItems, origin: 'snapshot', sourceLabel: 'test' };
  state.loading = false;
}

describe('所有福利的完整原文閱讀', () => {
  it('所有給付、條件及擴充內容分段後可逐字還原，長給付確實分段', () => {
    let longest = '';
    for (const item of realItems) {
      const groups = sourceConditions(item);
      const originals = [item.benefit.raw ?? '', item.eligibility.raw_summary ?? '',
        ...groups.flatMap(group => group.entries)];
      for (const raw of originals) expect(sourceParagraphs(raw).join('')).toBe(raw);
      if ((item.benefit.raw?.length ?? 0) > longest.length) longest = item.benefit.raw!;
      for (const key of ['age', 'income', 'household', 'residence', 'student', 'employment', 'disability', 'nationality', 'property'] as const) {
        for (const rule of item.eligibility[key]) if (rule.raw?.trim()) expect(groups.flatMap(g => g.entries)).toContain(rule.raw);
      }
      for (const excluded of item.eligibility.exclusions) expect(groups.flatMap(g => g.entries)).toContain(excluded);
      for (const extension of item.extensions ?? []) if (extension.raw?.trim()) expect(groups.flatMap(g => g.entries)).toContain(extension.raw);
    }
    expect(sourceParagraphs(longest).length).toBeGreaterThan(5);
  });
  it('分段不刪除換行、空白、網址、數字、例外或標點', async () => {
    const raw = '  每月5,000元；\n但不得與其他方案併領。\nhttps://example.org/a?q=1&n=2';
    expect(sourceParagraphs(raw).join('')).toBe(raw);
    const html = await render(SourceText, { text: raw });
    expect(html).toContain('每月5,000元；');
    expect(html).toContain('但不得與其他方案併領。');
    expect(html).toContain('https://example.org/a?q=1&amp;n=2');
  });
  it('總覽全部模式不遺漏任何資料，入口顯示真實總數', async () => {
    loadCatalog();
    const all = browseCatalog(realItems, { today: '2026-11-08', includeUncertain: true, includeClosed: true });
    expect(new Set(all.map(i => i.id))).toEqual(new Set(realItems.map(i => i.id)));
    expect(await render(BrowseView)).toContain(`查看全部 ${realItems.length} 項福利與補助`);
  });
  it('217 筆詳情與結果卡均可渲染，完整條件與來源入口皆保留', async () => {
    loadCatalog();
    for (const item of realItems) {
      state.detailId = item.id;
      const html = await render(DetailView);
      expect(html).toContain('完整條件與初篩說明');
      expect(html).toContain('資料來源');
      for (const group of sourceConditions(item)) expect(html).toContain(group.label);
      const card = await render(ResultCard, { item, result: undefined });
      const plain = plainLanguageFor(item);
      expect(plain, item.id).not.toBeNull();
      expect(html).toContain('先看重點');
      expect(card).toContain('白話導讀：');
    }
  }, 20000);
});
