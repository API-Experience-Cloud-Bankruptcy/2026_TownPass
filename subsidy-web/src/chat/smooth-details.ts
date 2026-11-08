// 訊息裡的展開區（<details>）：點開時高度順順長出來、內容淡入，收合時再縮回去，
// 而不是一瞬間整塊跳出。中途再點一次會從目前高度直接反轉。
// 鍵盤（Enter／空白鍵）觸發的也是 summary 的 click，所以一併適用；減少動態效果時維持原生行為。
import type { Directive } from 'vue';
import { prefersReducedMotion } from './typing';

const DURATION = 300;
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

type Running = { anim: Animation; opening: boolean };
const running = new WeakMap<HTMLDetailsElement, Running>();

/** 收合時的高度：summary 加上 details 本身的上框線與上下內距（收合狀態下沒有額外下內距）。 */
function closedHeight(details: HTMLDetailsElement, summary: HTMLElement): number {
  const cs = getComputedStyle(details);
  return summary.offsetHeight + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
}

function onClick(event: MouseEvent) {
  animateToggle(event, event.currentTarget as HTMLElement);
}

function animateToggle(event: MouseEvent, summary: HTMLElement) {
  const details = summary.parentElement;
  if (!(details instanceof HTMLDetailsElement) || !details.animate || prefersReducedMotion()) return;
  event.preventDefault();

  const prev = running.get(details);
  const opening = prev ? !prev.opening : !details.open;
  const from = details.getBoundingClientRect().height;
  prev?.anim.cancel();

  details.classList.toggle('is-closing', !opening);
  if (opening) details.open = true;
  const to = opening ? details.offsetHeight : closedHeight(details, summary);

  details.style.overflow = 'hidden';
  const anim = details.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: DURATION, easing: EASING, fill: 'forwards' });
  if (opening && !prev) {
    for (const child of Array.from(details.children)) {
      if (child === summary) continue;
      (child as HTMLElement).animate?.(
        [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
        { duration: DURATION, easing: EASING, delay: 60, fill: 'backwards' },
      );
    }
  }
  running.set(details, { anim, opening });
  anim.onfinish = () => {
    if (!opening) details.open = false;
    details.classList.remove('is-closing');
    anim.cancel();
    running.delete(details);
    // 內容在展開後才載入（v-if 綁 open 狀態）時，實際高度會比量到的高：再順順長到實際高度。
    const natural = details.offsetHeight;
    if (opening && Math.abs(natural - to) > 4) {
      const grow = details.animate([{ height: `${to}px` }, { height: `${natural}px` }], { duration: 220, easing: EASING });
      grow.onfinish = grow.oncancel = () => { details.style.overflow = ''; };
      return;
    }
    details.style.overflow = '';
  };
}

export const vSmoothDetails: Directive<HTMLDetailsElement> = {
  mounted(el) {
    el.querySelector<HTMLElement>(':scope > summary')?.addEventListener('click', onClick);
  },
  beforeUnmount(el) {
    el.querySelector<HTMLElement>(':scope > summary')?.removeEventListener('click', onClick);
    running.get(el)?.anim.cancel();
  },
};

/**
 * 全站的 <details>：在 document 上監聽 summary 點擊，同樣以高度動畫展開收合。
 * 已由 v-smooth-details 處理（preventDefault）的、或標了 data-motion="off" 的不重複處理。
 */
export function installSmoothDetails(): void {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target as Element | null;
    const summary = target?.closest?.('summary');
    if (!summary || !(summary instanceof HTMLElement)) return;
    // summary 內的連結、按鈕照常運作
    const interactive = target?.closest?.('a, button, input, select, textarea, label');
    if (interactive && summary.contains(interactive)) return;
    const details = summary.parentElement;
    if (!(details instanceof HTMLDetailsElement) || details.dataset.motion === 'off' || summary !== details.querySelector(':scope > summary')) return;
    animateToggle(event, summary);
  });
}
