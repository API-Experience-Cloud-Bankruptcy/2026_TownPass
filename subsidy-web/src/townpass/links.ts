// App 的 WebView 不處理 target="_blank"、tel:、mailto:，點了會沒反應。
// 在城市通內統一攔截所有 <a> 點擊：網頁用 open_link 疊一層 App 內網頁，電話用 phone_call，
// 其他外部 App 協定（mailto: 等）用 launch_map（App 端是通用的 launchUrl）。一般瀏覽器不攔截。

import { isInTownPass } from './bridge';
import { launchMap, openLink, phoneCall } from './index';

export type LinkAction =
  | { kind: 'open'; url: string }
  | { kind: 'call'; number: string }
  | { kind: 'launch'; url: string }
  | null;

/** 決定一個連結在 App 內該怎麼開；null 表示交給 WebView 自己處理（同頁錨點、blob 下載等）。 */
export function linkAction(anchor: HTMLAnchorElement, pageOrigin: string): LinkAction {
  if (anchor.hasAttribute('download')) return null;
  let url: URL;
  try { url = new URL(anchor.href); } catch { return null; }
  if (url.protocol === 'tel:') {
    const number = decodeURIComponent(url.href.slice(4)).replace(/[^\d,+#*]/g, '');
    return number ? { kind: 'call', number } : null;
  }
  if (url.protocol === 'mailto:' || url.protocol === 'sms:') return { kind: 'launch', url: url.href };
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.origin === pageOrigin && anchor.target !== '_blank') return null;
  return { kind: 'open', url: url.href };
}

export function installLinkHandler(doc: Document = document): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!isInTownPass()) return;
    const anchor = (event.target as Element | null)?.closest?.('a[href]');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const action = linkAction(anchor, doc.location?.origin ?? '');
    if (!action) return;
    event.preventDefault();
    if (action.kind === 'open') openLink(action.url);
    else if (action.kind === 'call') void phoneCall(action.number).catch(() => undefined);
    else void launchMap(action.url).catch(() => undefined);
  };
  doc.addEventListener('click', onClick);
  return () => doc.removeEventListener('click', onClick);
}
