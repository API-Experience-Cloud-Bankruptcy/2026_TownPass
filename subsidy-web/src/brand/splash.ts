// 進入補助專區的開場畫面：index.html 內嵌（JS 還沒載入就看得到）。
// Logo 一筆寫出 → 停一下 → 依書寫順序消失 → 再寫，循環到資料載入完成；
// 收起時挑 Logo 完整的那一刻淡出，不會在寫一半時消失。

/** 開場至少停留到 Logo 第一次寫完（從頁面開始載入算起）。 */
const MIN_VISIBLE_MS = 1250;
/** 資料一直沒回來時也要收起，讓錯誤訊息與重試按鈕看得到。 */
export const SPLASH_MAX_WAIT_MS = 6000;
/** 與 index.html 的 splash-loop 一致：一圈的長度，以及 Logo 完整顯示的區段。 */
const LOOP_MS = 2600;
const FULL_FROM = 0.42;
const FULL_TO = 0.56;

let markGone: () => void = () => undefined;
/** 開場畫面收起後才 resolve；沒有開場畫面（測試、重新整理後）時立即 resolve。 */
export const splashGone: Promise<void> =
  typeof document !== 'undefined' && document.getElementById('splash')
    ? new Promise((resolve) => { markGone = resolve; })
    : Promise.resolve();

function removeSplash(splash: HTMLElement): void {
  splash.remove();
  markGone();
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 距離下一次「Logo 完整」還要等多久；已在完整區段內則為 0。 */
function untilFull(ink: Element | null): number {
  const anim = ink?.getAnimations?.()[0];
  const timing = anim?.effect?.getComputedTiming();
  const p = timing?.progress;
  if (p == null || timing?.currentIteration == null) return 0;
  if (p >= FULL_FROM && p <= FULL_TO - 0.04) return 0;
  const target = FULL_FROM + 0.01;
  return ((target - p + 1) % 1) * LOOP_MS;
}

/** 收起開場畫面。重複呼叫只會執行一次。 */
export async function dismissSplash(): Promise<void> {
  const splash = document.getElementById('splash');
  if (!splash || splash.dataset.leaving) return;
  splash.dataset.leaving = '1';

  const calm = reducedMotion();
  if (!calm) {
    const wait = MIN_VISIBLE_MS - performance.now();
    if (wait > 0) await sleep(wait);
    await sleep(untilFull(splash.querySelector('.splash__ink')));
  }

  splash.style.pointerEvents = 'none';
  splash.setAttribute('aria-hidden', 'true');
  if (calm || typeof splash.animate !== 'function') {
    removeSplash(splash);
    return;
  }

  // 停在寫好的樣子，整個畫面淡出、Logo 微微放大，像往前遞給使用者。
  splash.querySelector<SVGElement>('.splash__logo')?.classList.add('is-done');
  splash.querySelector('.splash__logo')?.animate(
    [{ transform: 'none' }, { transform: 'scale(1.06)' }],
    { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
  );
  const fade = splash.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 380,
    delay: 60,
    easing: 'ease-out',
    fill: 'forwards',
  });
  setTimeout(markGone, 200);
  await fade.finished.catch(() => undefined);
  removeSplash(splash);
}
