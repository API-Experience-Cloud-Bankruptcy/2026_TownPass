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
  const summary = event.currentTarget as HTMLElement;
  const details = summary.parentElement;
  if (!(details instanceof HTMLDetailsElement) || !details.animate || prefersReducedMotion()) return;
  event.preventDefault();

  const prev = running.get(details);
  const opening = prev ? !prev.opening : !details.open;
  const from = details.getBoundingClientRect().height;
  prev?.anim.cancel();

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
    details.style.overflow = '';
    anim.cancel();
    running.delete(details);
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
