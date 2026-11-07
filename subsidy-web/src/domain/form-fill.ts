// 申請表填寫引擎：只填「申請人本人」且「使用者已確認」的資料，簽名欄永遠不填。
// 座標與旋轉映射已用真實渲染驗證，見 docs/form-fields-integration.md §3.1。
// 引擎本身不碰網路、不讀 userinfo；呼叫端負責取得 PDF 位元組、字型與 ConfirmedProfile。

import { degrees, PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { FormEntry, FormField } from './form-fields';
import type { ConfirmedProfile } from './form-profile';
import type { Target } from './types';

export type SkipReason =
  | 'not_self'            // 目前不是替本人申請
  | 'signature'           // 簽名／蓋章欄，一律不填
  | 'not_applicant'       // 資料沒有確認是申請人本人
  | 'no_value'            // 使用者沒有確認這項資料
  | 'prefix_mismatch'     // 表單已印好的地址前綴與使用者地址不符
  | 'too_wide'            // 縮到最小字級仍放不進欄位，不截斷
  | 'page_missing';

export interface PlannedFill { field: FormField; value: string }
export interface SkippedField { field: FormField; reason: SkipReason }
export interface FillPlan { fills: PlannedFill[]; skipped: SkippedField[] }
export interface FillReport extends FillPlan { bytes: Uint8Array; drawn: PlannedFill[] }

const HOME_LABEL = /住宅|住家|市話|家用|戶籍地電話/;
const REGISTERED_LABEL = /戶籍/;
const norm = (s: string) => s.replace(/[\s　]/g, '').replace(/台/g, '臺');

function addressKind(field: FormField): 'registered' | 'contact' {
  if (field.variant === 'registered' || REGISTERED_LABEL.test(field.label)) return 'registered';
  return 'contact';
}

/** 依欄位類別取出已確認的值；沒有就回傳 undefined（不跨類別借用）。 */
function valueFor(field: FormField, p: ConfirmedProfile): string | undefined {
  switch (field.prefill_key) {
    case 'name': return p.name;
    case 'national_id': return p.nationalId;
    case 'gender': return p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : undefined;
    case 'mobile': return p.mobile;
    case 'phone': return field.variant === 'home' || HOME_LABEL.test(field.label) ? p.homePhone : p.mobile ?? p.homePhone;
    case 'address': return addressKind(field) === 'registered' ? p.registeredAddress : p.contactAddress;
    default: return undefined;
  }
}

/** 去掉表單已印好的前綴（容許空白與「台／臺」差異）。 */
function stripPrefix(value: string, prefix: string): string {
  let need = norm(prefix).length;
  let i = 0;
  while (i < value.length && need > 0) { if (!/[\s\u3000]/.test(value[i])) need--; i++; }
  return value.slice(i).replace(/^[：:\s\u3000]+/, '');
}

/** 欄位是否被資料端明確允許自動填寫。與後端 prefill 規則的雙重保險。 */
export function isAutoFillable(field: FormField): boolean {
  return field.prefill === true
    && !!field.prefill_key
    && field.type !== 'signature' && field.type !== 'checkbox'
    && field.key !== 'signature'
    && !field.candidate_key && !field.blocked_reason
    && field.subject === 'applicant';
}

/** 純函式：決定哪些欄位會填、哪些不填及原因。只有替本人申請（target === 'self'）才會填。 */
export function planFill(entry: Pick<FormEntry, 'fields'>, profile: ConfirmedProfile, target: Target | null): FillPlan {
  const fills: PlannedFill[] = [];
  const skipped: SkippedField[] = [];
  for (const field of entry.fields) {
    const personal = field.prefill || !!field.candidate_key;
    if (field.type === 'signature' || field.key === 'signature') { skipped.push({ field, reason: 'signature' }); continue; }
    if (!personal) continue;
    if (target !== 'self') { skipped.push({ field, reason: 'not_self' }); continue; }
    if (!isAutoFillable(field)) { skipped.push({ field, reason: 'not_applicant' }); continue; }
    let value = valueFor(field, profile)?.trim();
    if (!value) { skipped.push({ field, reason: 'no_value' }); continue; }
    if (field.preprinted_prefix) {
      if (!norm(value).startsWith(norm(field.preprinted_prefix))) { skipped.push({ field, reason: 'prefix_mismatch' }); continue; }
      value = stripPrefix(value, field.preprinted_prefix);
      if (!value) { skipped.push({ field, reason: 'no_value' }); continue; }
    }
    fills.push({ field, value });
  }
  return { fills, skipped };
}

/** 顯示座標（左上原點）→ CropBox 內的使用者座標。 */
function toUser(R: number, dx: number, dy: number, W0: number, H0: number): [number, number] {
  switch (R) {
    case 0: return [dx, H0 - dy];
    case 90: return [dy, dx];
    case 180: return [W0 - dx, dy];
    case 270: return [W0 - dy, H0 - dx];
    default: throw new Error(`不支援的頁面旋轉 ${R}`);
  }
}

/**
 * 關閉 OpenType 字形替換。預設替換會把拉丁字母後的數字換成替代字形：字距變寬，
 * 且 ToUnicode 對應錯誤（複製、搜尋得到亂碼）。身分證字號 A123456789 正好會中招。
 * 清單與 checklist-pdf.ts 的 PLAIN_GLYPHS 相同；刻意複製，避免動到該檔。
 */
const PLAIN_GLYPHS = Object.fromEntries(['aalt', 'calt', 'ccmp', 'clig', 'curs', 'dlig', 'dnom', 'fwid', 'halt', 'hist', 'hwid', 'kern', 'liga', 'locl', 'mark', 'mkmk', 'numr', 'palt', 'pwid', 'rclt', 'rlig', 'ruby', 'rvrn', 'vert', 'vhal', 'vkrn', 'vpal', 'vrt2'].map((f) => [f, false]));

const MAX_SIZE = 11;
const MIN_SIZE = 6.5;
const PAD = 2;

/** 把已確認資料畫到空白表單上。回傳完整 PDF（所有頁）與實際填寫／略過的清單。 */
export async function fillForm(
  pdfBytes: Uint8Array,
  fontBytes: Uint8Array | ArrayBuffer,
  entry: Pick<FormEntry, 'fields'>,
  profile: ConfirmedProfile,
  target: Target | null,
): Promise<FillReport> {
  const plan = planFill(entry, profile, target);
  const doc = await PDFDocument.load(pdfBytes);
  doc.registerFontkit(fontkit);
  // 完整嵌入：subset 的 CJK 字型在部分渲染器缺字（同 checklist-pdf.ts）。
  const font = await doc.embedFont(fontBytes, { subset: false, features: PLAIN_GLYPHS });
  const pages = doc.getPages();
  const drawn: PlannedFill[] = [];
  const skipped = [...plan.skipped];
  for (const fill of plan.fills) {
    const { box } = fill.field;
    const page = pages[box.page - 1];
    if (!page) { skipped.push({ field: fill.field, reason: 'page_missing' }); continue; }
    const maxW = Math.max(0, box.w - PAD * 2);
    let size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, box.h * 0.6));
    while (size > MIN_SIZE && font.widthOfTextAtSize(fill.value, size) > maxW) size -= 0.5;
    if (font.widthOfTextAtSize(fill.value, size) > maxW) { skipped.push({ field: fill.field, reason: 'too_wide' }); continue; }
    // 單行欄位垂直置中；高欄位（多行格）靠上。
    const baseline = box.h <= size * 1.8 + 4 ? box.y + box.h / 2 + size * 0.35 : box.y + size + 3;
    const R = page.getRotation().angle;
    const cb = page.getCropBox();
    const [ux, uy] = toUser(R, Math.max(0, box.x) + PAD, baseline, cb.width, cb.height);
    page.drawText(fill.value, { x: cb.x + ux, y: cb.y + uy, size, font, color: rgb(0, 0, 0), rotate: degrees(R) });
    drawn.push(fill);
  }
  return { ...plan, skipped, drawn, fills: plan.fills, bytes: await doc.save() };
}

/** 給 UI 用的摘要：哪些得自己填、哪些得親簽。 */
export function manualSummary(entry: Pick<FormEntry, 'fields'>, report: Pick<FillReport, 'drawn'>) {
  const drawn = new Set(report.drawn.map((d) => d.field));
  const remaining = entry.fields.filter((f) => f.type !== 'signature' && f.key !== 'signature' && f.type !== 'checkbox' && !drawn.has(f));
  return {
    drawn: report.drawn.length,
    signatures: entry.fields.filter((f) => f.type === 'signature' || f.key === 'signature').length,
    checkboxes: entry.fields.filter((f) => f.type === 'checkbox').length,
    otherBlanks: remaining.length,
  };
}
