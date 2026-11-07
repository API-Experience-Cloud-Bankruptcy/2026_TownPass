import { describe, expect, it } from 'vitest';
import { LOGO_PATH, RING_PATH, logoViewBox } from '../brand/logo';
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

  it('思考圓圈與 Logo 的指令結構相同，才能互相變形', () => {
    const shape = (d: string) => [d.replace(/[^A-Za-z]/g, ''), d.match(/-?\d+(\.\d+)?/g)?.length];
    expect(shape(RING_PATH)).toEqual(shape(LOGO_PATH));
  });
});
