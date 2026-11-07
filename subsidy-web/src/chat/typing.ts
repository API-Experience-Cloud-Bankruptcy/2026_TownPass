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

/** 換人或清除資料時重來。 */
export function resetTyped(): void {
  typed.clear();
}

const MS_PER_CHAR = 38;
const MAX_DURATION = 1800;
const MIN_MS_PER_CHAR = 4;

/**
 * 每個字的間隔：短句照正常速度；字越多越快，整則最多約 1.8 秒打完。
 * 例：20 字 → 38ms／字（0.76 秒）；100 字 → 18ms／字；500 字 → 4ms／字。
 */
export function msPerChar(length: number): number {
  if (length <= 0) return 0;
  return Math.max(MIN_MS_PER_CHAR, Math.min(MS_PER_CHAR, MAX_DURATION / length));
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

/** 捲動時記錄使用者是否停在底部附近；往上翻閱時就不再自動跟著捲。 */
export function trackPinned(): void {
  if (typeof window === 'undefined') return;
  const doc = document.documentElement;
  pinned = window.innerHeight + window.scrollY >= doc.scrollHeight - 160;
}

/** 新訊息或內容長高時捲到底；force 用於換題（使用者剛按下選項）。 */
export function followBottom(force = false): void {
  if (typeof window === 'undefined') return;
  if (force) pinned = true;
  if (!pinned) return;
  const doc = document.documentElement;
  window.scrollTo?.({ top: doc.scrollHeight, behavior: force && !prefersReducedMotion() ? 'smooth' : 'auto' });
}
