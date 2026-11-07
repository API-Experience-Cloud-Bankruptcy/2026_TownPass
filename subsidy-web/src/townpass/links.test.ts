import { describe, expect, it } from 'vitest';
import { linkAction } from './links';

const a = (href: string, opts: { target?: string; download?: boolean } = {}) =>
  ({ href, target: opts.target ?? '', hasAttribute: (n: string) => n === 'download' && !!opts.download }) as unknown as HTMLAnchorElement;
const origin = 'http://192.168.0.2:5173';

describe('App 內連結處理', () => {
  it('外部網頁改用 App 內新頁面開啟', () => {
    expect(linkAction(a('https://service.taipei/', { target: '_blank' }), origin)).toEqual({ kind: 'open', url: 'https://service.taipei/' });
    expect(linkAction(a('https://www.gov.taipei/x'), origin)).toEqual({ kind: 'open', url: 'https://www.gov.taipei/x' });
  });
  it('電話與郵件交給手機', () => {
    expect(linkAction(a('tel:1999,1609'), origin)).toEqual({ kind: 'call', number: '1999,1609' });
    expect(linkAction(a('mailto:apply@example.org'), origin)).toEqual({ kind: 'launch', url: 'mailto:apply@example.org' });
  });
  it('同頁錨點、檔案下載、blob 交回 WebView', () => {
    expect(linkAction(a(`${origin}/#main`), origin)).toBeNull();
    expect(linkAction(a('blob:http://x/1', { target: '_blank' }), origin)).toBeNull();
    expect(linkAction(a('https://x.gov.tw/f.pdf', { download: true }), origin)).toBeNull();
  });
});
