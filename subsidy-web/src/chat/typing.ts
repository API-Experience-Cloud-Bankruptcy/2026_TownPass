// 對話介面的打字效果。不是 AI 生成：文字都來自既有題庫與資料，只是逐字顯示。

import { reactive } from 'vue';

/** 訊息泡泡裡的一行。 */
export interface Line {
  text: string;
  tone?: 'title' | 'muted' | 'caption' | 'alert';
}

/** 已經播放完的訊息；返回或改答案時不再重打，直接顯示全文。 */
export const typed = reactive(new Set<string>());

export function isTyped(key: string): boolean {
  return typed.has(key);
}

export function markTyped(key: string): void {
  typed.add(key);
}

/** 修改某一則時，之後的訊息要重新播放；keep 回傳 true 的保留（修改點以上仍在畫面上的訊息）。 */
export function forgetTyped(keep: (key: string) => boolean): void {
  for (const key of [...typed]) if (!keep(key)) typed.delete(key);
}

/** 換人或清除資料時重來。 */
export function resetTyped(): void {
  typed.clear();
}

const MS_PER_CHAR = 38;
const BASE_MS = 700;
const GROWTH_MS = 120;
const MAX_DURATION = 3500;

/**
 * 整則打完的時間：短句照正常速度（38ms／字）；字多時總時間只按平方根成長，
 * 長文仍看得到逐字打出，不會一下子整段跳出。上限 3.5 秒，點泡泡可直接看全文。
 * 例：20 字 0.76 秒；100 字 1.9 秒；400 字 3.1 秒；1000 字以上 3.5 秒。
 */
export function typingDuration(length: number): number {
  if (length <= 0) return 0;
  return Math.min(length * MS_PER_CHAR, BASE_MS + GROWTH_MS * Math.sqrt(length), MAX_DURATION);
}

/** 平均每個字的間隔（毫秒）。 */
export function msPerChar(length: number): number {
  return length > 0 ? typingDuration(length) / length : 0;
}

/** 經過 elapsed 毫秒時應該顯示幾個字。 */
export function charsAt(elapsed: number, length: number): number {
  const step = msPerChar(length);
  if (step === 0) return length;
  return Math.min(length, Math.floor(elapsed / step));
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

let pinned = true;
let autoUntil = 0;

/**
 * 捲動地板：選項收合時對話內容變短，若已捲到接近底部，瀏覽器會把捲動位置往上夾，
 * 整段對話看起來先往下掉、接著又被自動捲動拉回。內容縮短時在底部補上剛好的留白
 * （--chat-floor），讓目前位置維持不動；新訊息長出來或使用者往上捲時留白自然消失。
 * 留白最多對話區高度的 FLOOR_MAX：一次收掉一大段（換需求、改答案）時，超過的部分照常隨收合動畫往下，
 * 不會停在一片空白。
 */
const FLOOR_MAX = 0.4;
const scrollState = new WeakMap<HTMLElement, { top: number; floor: number }>();

function stateOf(log: HTMLElement) {
  let s = scrollState.get(log);
  if (!s) scrollState.set(log, (s = { top: log.scrollTop, floor: 0 }));
  return s;
}

function setFloor(log: HTMLElement, s: { floor: number }, px: number): void {
  if (px === s.floor) return;
  s.floor = px;
  log.style.setProperty('--chat-floor', `${px}px`);
}

/** 內容長高或縮短後呼叫（ResizeObserver／MutationObserver）：補足地板並還原被夾掉的捲動位置。 */
export function keepScroll(): void {
  if (typeof window === 'undefined') return;
  const log = document.querySelector<HTMLElement>('.chat__log');
  if (!log?.clientHeight) return;
  const s = stateOf(log);
  const natural = log.scrollHeight - s.floor;
  // 只在原位置捲不到時才算被夾；其他捲動變化（使用者、平滑捲動）由 trackPinned 記錄。
  const clamped = log.scrollTop < s.top - 1 && log.scrollHeight - log.clientHeight < s.top - 1;
  const cap = Math.round(log.clientHeight * FLOOR_MAX);
  setFloor(log, s, Math.min(cap, Math.max(0, Math.ceil(s.top + log.clientHeight - natural))));
  if (clamped) {
    log.scrollTop = s.top;
    // 超過上限時還原不到原位，以實際停下的位置為準。
    s.top = log.scrollTop;
  }
}

/**
 * 回到「找資源」時還原離開前的捲動位置。KeepAlive 暫存期間元素不在畫面上，瀏覽器會把捲動歸零，
 * 不還原的話回來時整段對話會從頂端一路捲下來。
 */
export function restoreScroll(): void {
  if (typeof window === 'undefined') return;
  const log = document.querySelector<HTMLElement>('.chat__log');
  const s = log && scrollState.get(log);
  if (log && s && Math.abs(log.scrollTop - s.top) > 1) log.scrollTop = s.top;
}

/** 捲動時記錄使用者是否停在底部附近；往上翻閱時就不再自動跟著捲。 */
export function trackPinned(): void {
  if (typeof window === 'undefined') return;
  const log = document.querySelector<HTMLElement>('.chat__log');
  if (log?.clientHeight) {
    const s = stateOf(log);
    // 往上移且原本的位置已經捲不到：是內容變短被瀏覽器夾住，不是使用者往上捲。
    // 平滑捲動途中被夾時，這個事件比 ResizeObserver 先到，所以在這裡就補地板、還原位置。
    if (log.scrollTop < s.top - 1 && log.scrollHeight - log.clientHeight < s.top - 1) {
      keepScroll();
      return;
    }
    s.top = log.scrollTop;
    // 往上捲時地板只降不升，捲回來不會多出空白。
    if (s.floor) setFloor(log, s, Math.min(s.floor, Math.max(0, Math.ceil(s.top + log.clientHeight - (log.scrollHeight - s.floor)))));
  }
  // 自己發起的平滑捲動途中離底部還遠，不能因此判定使用者往上翻。
  if (performance.now() < autoUntil) return;
  if (log?.clientHeight) pinned = log.scrollTop + log.clientHeight >= log.scrollHeight - stateOf(log).floor - 160;
}

/**
 * 這一輪回覆的開頭：最後一則使用者訊息之後的第一則福利連訊息；還沒回覆時就是使用者剛送出的那則。
 * 結果頁連續好幾則回覆時，錨點是第一則，從頭讀起。
 */
function latestReply(log: HTMLElement): HTMLElement | null {
  const msgs = [...log.querySelectorAll<HTMLElement>('.msg')];
  let anchor: HTMLElement | null = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].classList.contains('msg--user')) return anchor ?? msgs[i];
    anchor = msgs[i];
  }
  return anchor;
}

/** 回覆頂端與對話區上緣保留的間隔。 */
const ANCHOR_GAP = 16;

/**
 * 新訊息或內容長高時平滑往下捲；force 用於換題（使用者剛按下選項或送出文字）。
 * 訊息從上往下排，內容超出畫面才開始往上推；最多推到「這一輪的回覆」頂端離上緣留一點間隔，
 * 回覆比畫面長時從開頭讀起、其餘往下延伸，不會一路捲到最底。
 */
export function followBottom(force = false): void {
  if (typeof window === 'undefined') return;
  if (force) pinned = true;
  if (!pinned) return;
  const log = document.querySelector<HTMLElement>('.chat__log');
  if (!log?.clientHeight) return;
  let target = log.scrollHeight - log.clientHeight;
  const anchor = latestReply(log);
  if (anchor) {
    target = Math.min(target, log.scrollTop + anchor.getBoundingClientRect().top - log.getBoundingClientRect().top - ANCHOR_GAP);
  }
  if (target <= log.scrollTop + 1) return;
  const smooth = !prefersReducedMotion();
  if (smooth) autoUntil = performance.now() + 600;
  log.scrollTo?.({ top: target, behavior: smooth ? 'smooth' : 'auto' });
}

/** 使用者手指或滾輪一動，就停止把捲動當成程式發起的。 */
export function releaseFollow(): void {
  autoUntil = 0;
}
