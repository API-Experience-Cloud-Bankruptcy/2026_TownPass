// 本分頁的答案與對話狀態保存在 sessionStorage；行動單項目與進度另由 action-plan.ts 存後端。
// 資格答案不送後端。顯示偏好（字體大小）不含個資，另存於 localStorage。
// 不讀取 TownPass userinfo（mock 帳號）作為任何人的資格條件。

import { validExtraValue } from './answer-fields';
import { MAX_AGE } from './questions';
import type { Answers, Target } from './types';

export const SESSION_KEY = 'welfare-tong:session:v1';
export const PERSONAL_PLAN_KEY = 'welfare-tong:personal-plan:v1';
export const PREFS_KEY = 'welfare-tong:prefs:v1';

export interface SessionState {
  v: 1;
  target: Target | null;
  situation: string | null;
  query: string;
  answers: Answers;
  /** 已看過（含答「不知道」）的題目 id */
  seenQuestions: string[];
  planIds: string[];
  docChecks: Record<string, boolean>;
  stepDone: Record<string, number[]>;
  catalogVersion: string | null;
  rulesVersion?: string | null;
  engineVersion?: string | null;
  savedAt: string | null;
}

export interface Prefs {
  /** 字體大小，百分比（100 = 標準 16px）。 */
  fontScale: number;
}

export const FONT_SCALE = { min: 90, max: 150, step: 10, default: 100 } as const;

/** 夾在可調範圍內並對齊刻度；非數字回到標準。 */
export function clampFontScale(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : FONT_SCALE.default;
  const snapped = Math.round(n / FONT_SCALE.step) * FONT_SCALE.step;
  return Math.min(FONT_SCALE.max, Math.max(FONT_SCALE.min, snapped));
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function emptySession(target: Target | null = null): SessionState {
  return {
    v: 1,
    target,
    situation: null,
    query: '',
    answers: {},
    seenQuestions: [],
    planIds: [],
    docChecks: {},
    stepDone: {},
    catalogVersion: null,
    rulesVersion: null,
    engineVersion: null,
    savedAt: null,
  };
}

/** 答案與進度：sessionStorage，關閉分頁後由瀏覽器清除（WebView 行為依平台而定）。 */
export function defaultStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** 顯示偏好與舊版資料清理用：localStorage。 */
export function prefsStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** 移除舊版曾寫入 localStorage 的答案資料（同一個 key）。 */
export function purgeLegacySession(legacy: StorageLike | null = prefsStorage()): void {
  try {
    legacy?.removeItem(SESSION_KEY);
  } catch {
    // 無法存取時略過
  }
}

const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

function sanitizeAnswers(v: unknown): Answers {
  if (!v || typeof v !== 'object') return {};
  const a = v as Record<string, unknown>;
  const out: Answers = {};
  if (typeof a.age === 'number' && Number.isFinite(a.age) && a.age >= 0 && a.age <= MAX_AGE) out.age = a.age;
  if (typeof a.region === 'string' && a.region.trim()) out.region = a.region;
  if (typeof a.is_student === 'boolean') out.is_student = a.is_student;
  if (a.household_type === 'low_income' || a.household_type === 'mid_low_income' || a.household_type === 'general') {
    out.household_type = a.household_type;
  }
  if (a.extra && typeof a.extra === 'object') {
    const extra: Record<string, string | number | boolean> = {};
    for (const [k, val] of Object.entries(a.extra as Record<string, unknown>)) {
      if (Object.keys(extra).length < 32 && validExtraValue(k,val)) extra[k] = val;
    }
    if (Object.keys(extra).length) out.extra = extra;
  }
  return out;
}

export function loadSession(storage: StorageLike | null = defaultStorage(), key = SESSION_KEY): SessionState {
  if (!storage) return emptySession();
  try {
    const raw = storage.getItem(key);
    if (!raw) return emptySession();
    const s = JSON.parse(raw) as Partial<SessionState>;
    if (s.v !== 1) return emptySession();
    const stepDone: Record<string, number[]> = {};
    for (const [k, val] of Object.entries(s.stepDone ?? {})) {
      if (Array.isArray(val)) stepDone[k] = val.filter((n) => Number.isInteger(n) && n >= 0);
    }
    const docChecks: Record<string, boolean> = {};
    for (const [k, val] of Object.entries(s.docChecks ?? {})) if (val === true) docChecks[k] = true;
    return {
      v: 1,
      target: s.target === 'self' || s.target === 'other' ? s.target : null,
      situation: typeof s.situation === 'string' ? s.situation : null,
      query: typeof s.query === 'string' ? s.query.slice(0, 200) : '',
      answers: sanitizeAnswers(s.answers),
      seenQuestions: isStrArr(s.seenQuestions) ? s.seenQuestions : [],
      planIds: isStrArr(s.planIds) ? s.planIds : [],
      docChecks,
      stepDone,
      catalogVersion: typeof s.catalogVersion === 'string' ? s.catalogVersion : null,
      rulesVersion: typeof s.rulesVersion === 'string' ? s.rulesVersion : null,
      engineVersion: typeof s.engineVersion === 'string' ? s.engineVersion : null,
      savedAt: typeof s.savedAt === 'string' ? s.savedAt : null,
    };
  } catch {
    return emptySession();
  }
}

export function saveSession(state: SessionState, storage: StorageLike | null = defaultStorage(), key = SESSION_KEY): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify({ ...state, savedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

/** 本人行動單與這次查詢分開；舊版他人檢核表不當成本人行動單。 */
export function loadPersonalPlan(storage: StorageLike | null = defaultStorage()): SessionState {
  let hasPersonal = false;
  try { hasPersonal = !!storage?.getItem(PERSONAL_PLAN_KEY); } catch { /* 儲存空間不可用 */ }
  const saved = loadSession(storage, hasPersonal ? PERSONAL_PLAN_KEY : SESSION_KEY);
  if (saved.target === 'other') return emptySession('self');
  return { ...saved, target: 'self', situation: null, query: '', seenQuestions: [] };
}

export function clearSession(
  storage: StorageLike | null = defaultStorage(),
  legacy: StorageLike | null = prefsStorage(),
): void {
  try {
    storage?.removeItem(SESSION_KEY);
  } catch {
    // 無法存取儲存空間時，畫面狀態仍會重設
  }
  purgeLegacySession(legacy);
}

/** 換人：清除答案、行動單與進度，只保留新的查詢對象。 */
export function switchPerson(target: Target): SessionState {
  return emptySession(target);
}

/** 是否有會被換人清除的資料。 */
export function hasPersonalData(state: SessionState): boolean {
  return (
    Object.keys(state.answers).length > 0 ||
    state.planIds.length > 0 ||
    Object.keys(state.docChecks).length > 0 ||
    Object.keys(state.stepDone).length > 0 ||
    state.seenQuestions.length > 0
  );
}

export function loadPrefs(storage: StorageLike | null = prefsStorage()): Prefs {
  try {
    const raw = storage?.getItem(PREFS_KEY);
    const p = raw ? (JSON.parse(raw) as Partial<Prefs> & { largeText?: unknown }) : {};
    // 舊版只有「放大字體」開關（125%），沿用為對應的字級。
    if (typeof p.fontScale !== 'number' && p.largeText === true) return { fontScale: 130 };
    return { fontScale: clampFontScale(p.fontScale) };
  } catch {
    return { fontScale: FONT_SCALE.default };
  }
}

export function savePrefs(prefs: Prefs, storage: StorageLike | null = prefsStorage()): void {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 偏好無法保存不影響使用
  }
}
