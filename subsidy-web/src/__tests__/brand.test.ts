import { describe, expect, it } from 'vitest';
import { LOGO_PATH, LOGO_START, RING_PATH, logoViewBox } from '../brand/logo';
import html from '../../index.html?raw';

describe('福利連 Logo', () => {
  it('開場畫面內嵌的路徑與元件共用同一條', () => {
    const paths = [...html.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const d of paths) expect(d).toBe(LOGO_PATH);
  });

  it('開場畫面的 viewBox 依筆畫粗細留邊', () => {
    const stroke = Number(/class="splash__ink"[^>]*stroke-width="(\d+)"/.exec(html)?.[1]);
    expect(html).toContain(`viewBox="${logoViewBox(stroke)}"`);
  });

  it('思考圓圈頭尾相接，筆可以一直繞', () => {
    const nums = RING_PATH.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(nums.slice(-2)).toEqual(nums.slice(0, 2));
  });

  it('筆從 Logo 的起筆點開始寫', () => {
    expect(LOGO_PATH.startsWith(`M${LOGO_START.x},${LOGO_START.y} `)).toBe(true);
  });
});
