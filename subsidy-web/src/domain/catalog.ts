// ResourceRepository：從 /api/catalog 讀取完整資料；API 不通或格式不符時改用建置快照。
// 快照是 backend/data/subsidies.json 原始檔，於建置時打包成獨立 chunk，結構與 API 相同（{version, items}）。

import type { Catalog, LoadedCatalog, Subsidy } from './types';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function apiBase(): string {
  const base = (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? '';
  return base.replace(/\/+$/, '');
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrOrNull = (v: unknown) => v === null || v === undefined || typeof v === 'string';
const isStrArr = (v: unknown) => Array.isArray(v) && v.every(isStr);
const isArrOf = (v: unknown, pred: (x: unknown) => boolean) => Array.isArray(v) && v.every(pred);
const hasRaw = (x: unknown) => isObj(x) && isStrOrNull(x.raw);

/** 檢查 UI 實際讀取的欄位；回傳第一個不符的欄位路徑，null 代表通過。 */
export function subsidyProblem(value: unknown): string | null {
  if (!isObj(value)) return '不是物件';
  const v = value;
  if (!isStr(v.id) || !v.id) return 'id';
  if (!isStr(v.name)) return 'name';
  if (!isObj(v.scope) || !isStr(v.scope.level) || !isStrArr(v.scope.regions)) return 'scope';
  if (!isObj(v.provider) || !isStr(v.provider.name)) return 'provider';
  if (!isObj(v.classification) || !isStr(v.classification.category)) return 'classification';
  if (!isObj(v.benefit) || !isStrOrNull(v.benefit.raw)) return 'benefit';
  const el = v.eligibility;
  if (!isObj(el)) return 'eligibility';
  for (const key of ['age', 'income', 'household', 'residence', 'student', 'disability', 'employment', 'nationality', 'property']) {
    if (!isArrOf(el[key], hasRaw)) return `eligibility.${key}`;
  }
  if (!isArrOf(el.age, (a) => isObj(a) && (a.min === null || typeof a.min === 'number') && (a.max === null || typeof a.max === 'number')))
    return 'eligibility.age';
  if (!isArrOf(el.household, (h) => isObj(h) && isStrArr(h.types))) return 'eligibility.household';
  if (!isArrOf(el.residence, (r) => isObj(r) && isStrOrNull(r.region))) return 'eligibility.residence';
  if (!isStrOrNull(el.raw_summary)) return 'eligibility.raw_summary';
  if (!isStrArr(el.exclusions)) return 'eligibility.exclusions';
  const app = v.application;
  if (!isObj(app)) return 'application';
  if (!isStrOrNull(app.process_text) || !isStrOrNull(app.channel_text) || !isStrOrNull(app.agency)) return 'application.text';
  if (!isStrArr(app.methods)) return 'application.methods';
  if (!isObj(app.deadline) || !isStrOrNull(app.deadline.raw)) return 'application.deadline';
  if (!isArrOf(app.required_documents, (d) => isObj(d) && isStr(d.name) && isStrOrNull(d.condition) && isStrOrNull(d.notes)
    && (d.regions === undefined || (isStrArr(d.regions) && d.regions.length > 0 && d.regions.every(r => r.trim())
      && ['registered', 'residence', 'application', 'unknown'].includes(String(d.region_basis)) && isStr(d.region_evidence) && !!d.region_evidence.trim()))
    && (d.region_basis === undefined || d.regions !== undefined) && (d.region_evidence === undefined || d.regions !== undefined)))
    return 'application.required_documents';
  if (!isObj(app.urls) || !isStrOrNull(app.urls.program) || !isStrOrNull(app.urls.apply) || !isStrOrNull(app.urls.form))
    return 'application.urls';
  if (v.extensions !== undefined && !isArrOf(v.extensions, (e) => isObj(e) && isStrOrNull(e.raw))) return 'extensions';
  const search = v.search;
  if (!isObj(search) || !isObj(search.facets) || !isStrArr(search.facets.applicant_types) || !isStrArr(search.keywords))
    return 'search';
  const meta = v.source_meta;
  if (!isObj(meta) || !isStr(meta.verification_status) || !isStrOrNull(meta.checked_date)) return 'source_meta';
  if (!isArrOf(meta.sources, (s) => isObj(s) && isStr(s.url) && isStr(s.role))) return 'source_meta.sources';
  return null;
}

function isSubsidy(value: unknown): value is Subsidy {
  return subsidyProblem(value) === null;
}

/** 驗證 catalog 結構；不合格回傳錯誤訊息。不修改、不裁切項目欄位。 */
export function validateCatalog(value: unknown): { ok: true; catalog: Catalog } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') return { ok: false, error: '回應不是物件' };
  const v = value as Record<string, unknown>;
  if (typeof v.version !== 'string' || !v.version) return { ok: false, error: '缺少 version' };
  if (!Array.isArray(v.items)) return { ok: false, error: '缺少 items 陣列' };
  if (v.items.length === 0) return { ok: false, error: 'items 為空' };
  for (let i = 0; i < v.items.length; i += 1) {
    const problem = subsidyProblem(v.items[i]);
    if (problem) return { ok: false, error: `第 ${i + 1} 筆資料欄位 ${problem} 不符` };
  }
  const ids = new Set(v.items.map((item) => (item as Subsidy).id));
  if (ids.size !== v.items.length) return { ok: false, error: 'id 重複' };
  if (!v.items.every(isSubsidy)) return { ok: false, error: '資料格式不符' };
  return { ok: true, catalog: { version: v.version, items: v.items as Subsidy[] } };
}

/**
 * 與後端 main.rs 相同的 FNV-1a 64 位元內容指紋（UTF-8 位元組），用 4 個 16 位元段計算以避免 BigInt。
 * 只用來辨識版本，不是密碼學完整性保證。
 */
export function fnv1a64(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let h0 = 0x2325;
  let h1 = 0x8422;
  let h2 = 0x9ce4;
  let h3 = 0xcbf2;
  for (let i = 0; i < bytes.length; i += 1) {
    h0 ^= bytes[i];
    // 乘以 FNV prime 0x100000001b3 = 0x1b3 + 2^40（第 2 段的 0x100）
    const r0 = h0 * 0x1b3;
    const r1 = h1 * 0x1b3 + Math.floor(r0 / 0x10000);
    const r2 = h2 * 0x1b3 + h0 * 0x100 + Math.floor(r1 / 0x10000);
    const r3 = h3 * 0x1b3 + h1 * 0x100 + Math.floor(r2 / 0x10000);
    h0 = r0 & 0xffff;
    h1 = r1 & 0xffff;
    h2 = r2 & 0xffff;
    h3 = r3 & 0xffff;
  }
  return [h3, h2, h1, h0].map((n) => n.toString(16).padStart(4, '0')).join('');
}

/** 快照版本：與後端 /api/catalog 相同格式，同一份原始檔得到同一版本。 */
export function snapshotVersion(raw: string): string {
  return `catalog-v1-${fnv1a64(raw)}`;
}

export async function loadSnapshot(): Promise<Catalog> {
  // 虛擬模組（vite.config.ts catalogSnapshot）逐字打包原始檔，獨立 chunk、按需載入。
  const module = await import('virtual:catalog-snapshot');
  const parsed: unknown = JSON.parse(module.default);
  const items = Array.isArray(parsed) ? parsed : [];
  const checked = validateCatalog({ version: snapshotVersion(module.default), items });
  if (!checked.ok) throw new Error(`建置快照格式不符：${checked.error}`);
  return checked.catalog;
}

interface LoadOptions {
  fetchImpl?: FetchLike;
  snapshot?: () => Promise<Catalog>;
  base?: string;
  timeoutMs?: number;
}

export async function loadCatalog(options: LoadOptions = {}): Promise<LoadedCatalog> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const snapshot = options.snapshot ?? loadSnapshot;
  const base = options.base ?? apiBase();
  const timeoutMs = options.timeoutMs ?? 8000;

  let reason = '';
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const response = await fetchImpl(`${base}/api/catalog`, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    if (!response.ok) {
      reason = `暫時無法取得線上資料（回應代碼 ${response.status}），先使用隨附資料。`;
    } else {
      const checked = validateCatalog(await response.json());
      if (checked.ok) {
        return {
          ...checked.catalog,
          origin: 'api',
          sourceLabel: '從服務取得的福利資料（原始來源見各項詳情）',
        };
      }
      reason = '線上資料格式不完整，先使用隨附資料。';
    }
  } catch (error) {
    reason = (error as Error)?.name === 'AbortError' ? '取得線上資料逾時，先使用隨附資料。' : '目前無法連上資料服務，先使用隨附資料。';
  } finally {
    if (timer) clearTimeout(timer);
  }

  const fallback = await snapshot();
  return {
    ...fallback,
    origin: 'snapshot',
    sourceLabel: '此版本隨附的福利資料（原始來源見各項詳情）',
    fallbackReason: reason,
  };
}
