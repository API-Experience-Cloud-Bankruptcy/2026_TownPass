// 申請表欄位（backend 的 application.form_fields）的讀取與 PDF 取得。
// 資料為外部輸入：逐欄驗證，壞掉的欄位直接丟棄，不信任型別。
// 規格見 docs/form-fields-integration.md。

import { apiBase, type FetchLike } from './catalog';

export type PrefillKey = 'name' | 'national_id' | 'gender' | 'phone' | 'mobile' | 'address';
const PREFILL_KEYS: readonly string[] = ['name', 'national_id', 'gender', 'phone', 'mobile', 'address'];

/** 顯示後頁面座標，PDF point，原點在左上角。 */
export interface FormBox { page: number; x: number; y: number; w: number; h: number }

export interface FormField {
  type: string;
  label: string;
  key: string;
  prefill: boolean;
  prefill_key?: PrefillKey;
  box: FormBox;
  variant?: string;
  subject?: string;
  candidate_key?: string;
  blocked_reason?: string;
  preprinted_prefix?: string;
  options?: string[];
}

export interface FormEntry {
  status: string;
  label: string;
  sourceUrl: string | null;
  localFile: string | null;
  fields: FormField[];
  requiresHandwritten: boolean;
  handwrittenEvidence: string[];
  reason: string;
  officeFiles: string[];
}

export interface FillableForm { id: string; label: string; main: boolean; entry: FormEntry }

export type FormAvailability =
  | { kind: 'fillable'; forms: FillableForm[] }
  /** 有官方入口但不能由本服務填寫：線上系統、ODT/DOCX、掃描檔、下載失敗等。 */
  | { kind: 'external'; status: string; url: string | null; reason: string }
  | { kind: 'none'; status: string; reason: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 後端只服務 `<12 hex>.pdf`；其他路徑一律不接受。 */
export const FORM_FILE = /^forms\/([0-9a-f]{12}\.pdf)$/;

function parseField(raw: unknown): FormField | null {
  if (!isObj(raw) || !isObj(raw.box)) return null;
  const b = raw.box;
  const page = num(b.page), x = num(b.x), y = num(b.y), w = num(b.w), h = num(b.h);
  if (page === null || !Number.isInteger(page) || page < 1 || x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null;
  const field: FormField = {
    type: str(raw.type), label: str(raw.label), key: str(raw.key), prefill: raw.prefill === true,
    box: { page, x, y, w, h },
  };
  if (typeof raw.prefill_key === 'string' && PREFILL_KEYS.includes(raw.prefill_key)) field.prefill_key = raw.prefill_key as PrefillKey;
  for (const k of ['variant', 'subject', 'candidate_key', 'blocked_reason', 'preprinted_prefix'] as const) {
    if (typeof raw[k] === 'string') field[k] = raw[k] as string;
  }
  if (Array.isArray(raw.options)) field.options = raw.options.filter((o): o is string => typeof o === 'string');
  return field;
}

function parseEntry(raw: unknown): FormEntry | null {
  if (!isObj(raw) || typeof raw.status !== 'string') return null;
  const policy = isObj(raw.signature_policy) ? raw.signature_policy : {};
  const fields = Array.isArray(raw.fields) ? raw.fields.map(parseField).filter((f): f is FormField => f !== null) : [];
  // 已知 18 筆共用 PDF 的姓名框落在標籤格（整合文件 §12.5）；禁止自動寫入。
  if (raw.local_file === 'forms/45c8c57e98bf.pdf') {
    for (const field of fields) if (field.prefill_key === 'name') {
      field.prefill = false; field.candidate_key = 'name'; field.blocked_reason = 'position_unverified';
    }
  }
  return {
    status: raw.status,
    label: str(raw.label),
    sourceUrl: str(raw.source_url) || null,
    localFile: str(raw.local_file) || null,
    fields,
    requiresHandwritten: policy.requires_handwritten === true,
    handwrittenEvidence: Array.isArray(policy.evidence)
      ? policy.evidence.map((e) => (isObj(e) ? str(e.text).trim() : '')).filter(Boolean).slice(0, 3)
      : [],
    reason: str(raw.reason),
    officeFiles: Array.isArray(raw.office_files) ? raw.office_files.filter((u): u is string => typeof u === 'string') : [],
  };
}

/** 判斷一筆資源的申請表能怎麼用。 */
export function formAvailability(item: { application?: unknown } | null | undefined): FormAvailability {
  const app = isObj(item?.application) ? item!.application : {};
  const rawMain = (app as Record<string, unknown>).form_fields;
  const main = parseEntry(rawMain);
  if (!main) return { kind: 'none', status: 'unknown', reason: '目前沒有可供填寫的申請表資訊' };
  const attachments = isObj(rawMain) && Array.isArray(rawMain.attachments) ? rawMain.attachments : [];
  const raws: unknown[] = [rawMain, ...attachments];
  const seen = new Set<string>();
  const forms: FillableForm[] = [];
  raws.forEach((raw, i) => {
    const e = parseEntry(raw);
    if (!e || e.status !== 'analyzed' || !e.localFile || !FORM_FILE.test(e.localFile) || !e.fields.length || seen.has(e.localFile)) return;
    seen.add(e.localFile);
    forms.push({ id: e.localFile, label: e.label || (i === 0 ? '申請表' : `附件 ${i}`), main: i === 0, entry: e });
  });
  if (forms.length) return { kind: 'fillable', forms };
  const url = main.officeFiles[0] ?? main.sourceUrl;
  if (['online_system', 'office_file_only', 'download_failed', 'scanned_image_pdf', 'text_unreadable', 'analysis_error'].includes(main.status)) {
    const reasons: Record<string, string> = {
      online_system: '這項補助需要到線上申請系統填寫，請開啟申請入口。',
      office_file_only: '這份表單需要另外下載，以文書軟體開啟或列印後填寫。',
      download_failed: '目前無法取得這份表單，請到來源網站下載。',
      scanned_image_pdf: '這份表單是掃描檔，目前無法自動填寫。請下載後自行填寫。',
      text_unreadable: '目前無法讀取這份表單的填寫欄位，請下載後自行填寫。',
      analysis_error: '目前無法自動填寫這份表單，請到來源網站下載後自行填寫。',
    };
    return { kind: 'external', status: main.status, url, reason: reasons[main.status]! };
  }
  return { kind: 'none', status: main.status, reason: '目前沒有可自動填寫的申請表，請向受理窗口或來源網站確認。' };
}

export function formPdfUrl(localFile: string, base: string = apiBase()): string | null {
  const m = FORM_FILE.exec(localFile);
  return m ? `${base}/api/forms/${m[1]}` : null;
}

const MAX_FORM_BYTES = 10 * 1024 * 1024;

/** 從後端取回原始空白表單 PDF；內容必須真的是 PDF。 */
export async function fetchFormPdf(
  entry: Pick<FormEntry, 'localFile'>,
  options: { base?: string; fetchImpl?: FetchLike } = {},
): Promise<Uint8Array> {
  const url = entry.localFile ? formPdfUrl(entry.localFile, options.base) : null;
  if (!url) throw new Error('暫時無法取得這份表單，請到來源網站下載。');
  const response = await (options.fetchImpl ?? ((u: string, i?: RequestInit) => fetch(u, i)))(url);
  if (!response.ok) throw new Error('表單暫時下載不了，請稍後再試，或到來源網站下載。');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_FORM_BYTES) throw new Error('這份表單超過可處理的大小，請到來源網站下載後自行填寫。');
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error('下載的檔案不是可填寫的 PDF，請到來源網站確認表單。');
  return bytes;
}
