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

/** 捲動時記錄使用者是否停在底部附近；往上翻閱時就不再自動跟著捲。 */
export function trackPinned(): void {
  if (typeof window === 'undefined') return;
  // 自己發起的平滑捲動途中離底部還遠，不能因此判定使用者往上翻。
  if (performance.now() < autoUntil) return;
  const log = document.querySelector<HTMLElement>('.chat__log');
  if (log?.clientHeight) pinned = log.scrollTop + log.clientHeight >= log.scrollHeight - 160;
}

/**
 * 新訊息或內容長高時平滑往下捲；force 用於換題（使用者剛按下選項）。
 * 最多捲到「這一輪的回覆」（目前題目、結果，即 #view-title 那則）頂端貼齊版頭：
 * 訊息比畫面長時從開頭讀起、往下延伸，不會一路捲到訊息最底。
 */
export function followBottom(force = false): void {
  if (typeof window === 'undefined') return;
  if (force) pinned = true;
  if (!pinned) return;
  const log = document.querySelector<HTMLElement>('.chat__log');
  if (!log?.clientHeight) return;
  let target = log.scrollHeight - log.clientHeight;
  const anchor = document.getElementById('view-title')?.closest('.msg');
  if (anchor) {
    target = Math.min(target, log.scrollTop + anchor.getBoundingClientRect().top - log.getBoundingClientRect().top - 12);
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
