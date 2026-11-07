import { describe, expect, it } from 'vitest';
import { charsAt, isTyped, markTyped, msPerChar, resetTyped, typingDuration } from '../typing';

describe('typing speed', () => {
  it('短句用正常速度', () => {
    expect(msPerChar(20)).toBe(38);
  });

  it('字越多越快，但總時間仍隨字數增加，上限 3.5 秒', () => {
    expect(msPerChar(100)).toBeLessThan(msPerChar(40));
    expect(typingDuration(400)).toBeGreaterThan(typingDuration(100));
    expect(typingDuration(400)).toBeGreaterThan(2500);
    expect(typingDuration(5000)).toBe(3500);
  });

  it('長文每一畫格（約 16ms）頂多出現幾個字，不會整段跳出', () => {
    expect(16 / msPerChar(300)).toBeLessThan(2);
    expect(16 / msPerChar(1000)).toBeLessThan(5);
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
