import { describe, expect, it } from 'vitest';
import { buildRoute, splitProcess, applicationInquiry } from '../route';
import { safeUrl } from '../url';
import { makeSubsidy } from './fixtures';

describe('safeUrl', () => {
  it('只允許 http/https', () => {
    expect(safeUrl('https://www.gov.taipei/')).toBe('https://www.gov.taipei/');
    expect(safeUrl('http://example.org/a')).toBe('http://example.org/a');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'ftp://x.org', '  ', null, 42, 'JaVaScRiPt:alert(1)']) {
      expect(safeUrl(bad)).toBeNull();
    }
  });
});

describe('辦理路線', () => {
  it('只有明確箭頭才拆步驟', () => {
    expect(splitProcess('甲→乙→丙')).toEqual({ steps: ['甲', '乙', '丙'], split: true });
    expect(splitProcess('先洽學校，再送件')).toEqual({ steps: ['先洽學校，再送件'], split: false });
    expect(splitProcess(null)).toEqual({ steps: [], split: false });
  });
  it('危險網址被略過並計數；來源類型決定官方標示', () => {
    const item = makeSubsidy({
      application: { urls: { program: 'https://a.gov.tw/', apply: 'javascript:alert(1)', form: 'https://b.org/f' } },
      source_meta: { sources: [{ url: 'https://a.gov.tw/', role: 'program', type: 'official' }] },
    } as any);
    const route = buildRoute(item);
    expect(route.links.map((l) => [l.kind, l.sourceKind, l.label])).toEqual([
      ['program', 'official', '官方說明頁'],
      ['form', 'unknown', '表單下載'],
    ]);
    expect(route.rejectedUrls).toBe(1);
  });
  it('未知來源類型的說明頁不稱官方', () => {
    const item = makeSubsidy({ source_meta: { sources: [] } } as any);
    expect(buildRoute(item).links[0]).toMatchObject({ sourceKind: 'unknown', label: '來源說明' });
  });
  it('電話與地址提示可行動，文件空白不代表免附', () => {
    const route = buildRoute(makeSubsidy({ application: { required_documents: [] } } as any));
    expect(route.missing).toContain('電話與地址請依受理窗口原文或來源網站確認。');
    expect(route.missing.some((m) => m.includes('不代表免附'))).toBe(true);
  });
});

describe('申請準備 PDF 窗口詢問', () => {
  it('依查詢對象產生問句', () => {
    expect(applicationInquiry(makeSubsidy(), 'other')).toContain('對方是否符合申請資格');
    expect(applicationInquiry(makeSubsidy(), 'self')).toContain('我是否符合申請資格');
  });
});
