import { describe, expect, it } from 'vitest';
import { charsAt, isTyped, markTyped, msPerChar, resetTyped } from '../typing';

describe('typing speed', () => {
  it('短句用正常速度', () => {
    expect(msPerChar(20)).toBe(38);
  });

  it('字越多越快，整則最多約 1.8 秒', () => {
    expect(msPerChar(100)).toBeLessThan(msPerChar(40));
    expect(msPerChar(100) * 100).toBeLessThanOrEqual(1800);
    expect(msPerChar(5000)).toBe(4);
  });

  it('依經過時間算出顯示字數，不超過全文', () => {
    expect(charsAt(0, 20)).toBe(0);
    expect(charsAt(380, 20)).toBe(10);
    expect(charsAt(99999, 20)).toBe(20);
    expect(charsAt(10, 0)).toBe(0);
  });

  it('播放過的訊息會記住，重設後清空', () => {
    markTyped('q:age');
    expect(isTyped('q:age')).toBe(true);
    resetTyped();
    expect(isTyped('q:age')).toBe(false);
  });
});
