import { describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';
import { clearSession, defaultStorage, emptySession, hasPersonalData, loadPrefs, loadSession, prefsStorage, purgeLegacySession, savePrefs, saveSession, SESSION_KEY, PREFS_KEY, switchPerson } from '../session';
import { loadPersonalPlan, PERSONAL_PLAN_KEY } from '../session';

function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('儲存位置', () => {
  it('答案預設用 sessionStorage，偏好用 localStorage', () => {
    const session = memory();
    const local = memory();
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('localStorage', local);
    expect(defaultStorage()).toBe(session);
    expect(prefsStorage()).toBe(local);
    saveSession({ ...emptySession('self'), answers: { age: 72 } });
    savePrefs({ fontScale: 120 });
    expect(session.map.has(SESSION_KEY)).toBe(true);
    expect(local.map.has(SESSION_KEY)).toBe(false);
    expect(local.map.has(PREFS_KEY)).toBe(true);
  });
});

describe('本機保存', () => {
  it('本人行動單獨立保存，不把舊版他人資料或目前查詢條件當成本人資料', () => {
    const storage = memory();
    saveSession({ ...emptySession('other'), answers: { age: 72 }, planIds: ['other'] }, storage);
    expect(loadPersonalPlan(storage)).toEqual(emptySession('self'));
    const self = { ...emptySession('self'), answers: { age: 30 }, planIds: ['self'], stepDone: { self: [0] } };
    saveSession(self, storage, PERSONAL_PLAN_KEY);
    expect(loadPersonalPlan(storage)).toMatchObject({ ...self, savedAt: expect.any(String) });
    expect(loadSession(storage).target).toBe('other');
    storage.removeItem(PERSONAL_PLAN_KEY);
    saveSession(self, storage);
    expect(loadPersonalPlan(storage)).toMatchObject({ ...self, savedAt: expect.any(String) });
  });
  it('保存後可還原答案與進度', () => {
    const s = memory();
    const state = { ...emptySession('other'), answers: { age: 72, region: '臺北市' }, planIds: ['A'], stepDone: { A: [0] } };
    saveSession(state, s);
    const loaded = loadSession(s);
    expect(loaded.target).toBe('other');
    expect(loaded.answers).toEqual({ age: 72, region: '臺北市' });
    expect(loaded.stepDone).toEqual({ A: [0] });
  });
  it('換人清除前一位的答案與行動單', () => {
    const state = { ...emptySession('other'), answers: { age: 72 }, planIds: ['A'], docChecks: { k: true } };
    expect(hasPersonalData(state)).toBe(true);
    const next = switchPerson('self');
    expect(next.target).toBe('self');
    expect(next.answers).toEqual({});
    expect(next.planIds).toEqual([]);
    expect(hasPersonalData(next)).toBe(false);
  });
  it('清除會移除本分頁資料與舊版 localStorage 資料', () => {
    const s = memory();
    const legacy = memory();
    saveSession(emptySession('self'), s);
    legacy.setItem(SESSION_KEY, JSON.stringify({ v: 1, answers: { age: 72 } }));
    clearSession(s, legacy);
    expect(s.map.has(SESSION_KEY)).toBe(false);
    expect(legacy.map.has(SESSION_KEY)).toBe(false);
  });
  it('舊版清理只移除答案 key，保留偏好', () => {
    const legacy = memory();
    legacy.setItem(SESSION_KEY, '{}');
    savePrefs({ fontScale: 120 }, legacy);
    purgeLegacySession(legacy);
    expect(legacy.map.has(SESSION_KEY)).toBe(false);
    expect(legacy.map.has(PREFS_KEY)).toBe(true);
    expect(loadPrefs(legacy).fontScale).toBe(120);
  });
  it('字體大小：舊版放大開關轉成 130%，超出範圍或壞資料夾回可調範圍', () => {
    const s = memory();
    s.setItem(PREFS_KEY, JSON.stringify({ largeText: true, highContrast: true }));
    expect(loadPrefs(s)).toEqual({ fontScale: 130 });
    s.setItem(PREFS_KEY, JSON.stringify({ fontScale: 999 }));
    expect(loadPrefs(s).fontScale).toBe(150);
    s.setItem(PREFS_KEY, JSON.stringify({ fontScale: 112 }));
    expect(loadPrefs(s).fontScale).toBe(110);
    s.setItem(PREFS_KEY, '{bad');
    expect(loadPrefs(s).fontScale).toBe(100);
  });
  it('損壞或超出範圍的資料被忽略', () => {
    const s = memory();
    s.setItem(SESSION_KEY, '{bad json');
    expect(loadSession(s)).toEqual(emptySession());
    s.setItem(SESSION_KEY, JSON.stringify({ v: 1, target: 'x', answers: { age: 999, household_type: 'rich' }, planIds: [1] }));
    const loaded = loadSession(s);
    expect(loaded.target).toBeNull();
    expect(loaded.answers).toEqual({});
    expect(loaded.planIds).toEqual([]);
  });
  it('儲存空間不可用時不拋錯', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(loadSession(broken)).toEqual(emptySession());
    expect(saveSession(emptySession(), broken)).toBe(false);
    expect(() => clearSession(broken)).not.toThrow();
  });
});
