// 畫面用的白話標示。只轉換既有資料與 MatchResult 欄位，不產生新規則或摘要文字。

import { text } from './domain/match';
import { availability } from './domain/adaptive';
import type { MatchResult, Subsidy } from './domain/types';

/** 結果列的短標：只有明確不符才標示；其餘待確認是預設狀態，不重複標記。 */
export function fitNote(result: MatchResult | undefined): string | null {
  return result?.fit === 'ineligible' ? '填寫的條件不符' : null;
}

/** 期限可能已過的簡短提示（取自 warnings，不另行計算）。 */
export function deadlineNote(result: MatchResult | undefined): string | null {
  return result?.warnings.some((w) => w.includes('可能已過')) ? '期限可能已過，請先確認' : null;
}

/** 補助類型短標：使用資料既有的短欄位，不截斷長原文。 */
export function benefitLabel(item: Subsidy): string {
  return text(item.benefit?.kind) || text(item.classification?.benefit_type) || text(item.classification?.category);
}

const STATUS_PLAIN: Record<string, string> = {
  verified: '資料已查核',
  partial: '資料部分查核',
  unverified: '資料尚未查核',
};

/** 資料狀態白話；放在「資料來源」展開區，不作主要標示。 */
export function statusPlain(status: string, checkedDate: string): string {
  const label = STATUS_PLAIN[status] ?? '資料狀態未註明';
  return checkedDate ? `${label}（${checkedDate}）` : label;
}

/** 步驟進度文字，例如「已準備 2／5 步」。 */
export function progressText(done: number, total: number): string {
  if (total === 0) return '沒有列出步驟';
  if (done >= total) return `${total} 步都準備好了`;
  return `已準備 ${done}／${total} 步`;
}

/** 目前要做的步驟索引；全部完成回傳 -1。 */
export function currentStepIndex(total: number, done: Iterable<number>): number {
  const set = new Set(done);
  for (let i = 0; i < total; i += 1) if (!set.has(i)) return i;
  return -1;
}

const CLOSED = /截止|暫停|停止|停辦|結束|額滿|不受理|尚未開放|未開放/;

/** 受理情形原文若提到截止、暫停等，原文照列作提示；不自行判斷是否仍可申請。 */
export function applicationStatusAlert(status: string): string | null {
  const t = status.trim();
  return t && CLOSED.test(t) ? `受理情形：${t}` : null;
}

/** 清單列與詳情頁共用的提醒：不符、期限、受理情形；都來自既有欄位。 */
export function itemFlags(item: Subsidy, result: MatchResult | undefined): string[] {
  return [fitNote(result), deadlineNote(result), applicationStatusAlert(text(item.source_meta?.application_status)),
    availability(item) === 'unknown' ? '受理時間需向窗口確認' : null].filter(
    (x): x is string => !!x,
  );
}

/**
 * 問答進度摘要。initialCount 是需求或搜尋的初始筆數；remainingCount 是「目前聚焦」的筆數
 * （去掉依填答明確不符者，並依探索方向收斂），不是符合資格的數量，也不是全部還不能排除的數量。
 */
export interface InsightLike {
  initialCount: number;
  remainingCount: number;
  answeredCount: number;
  reason?: string;
  nonIneligibleCount?: number;
  excludedCount?: number;
  weakCount?: number;
}

function count(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** 例：「已回答 2 題・目前聚焦 14 項」；未回答時只說目前聚焦的數量。 */
export function insightLine(insight: InsightLike | null | undefined): string {
  if (!insight) return '';
  const answered = count(insight.answeredCount);
  const remaining = count(insight.remainingCount);
  const parts: string[] = [];
  if (answered) parts.push(`已回答 ${answered} 題`);
  if (remaining !== null) parts.push(`目前聚焦 ${remaining} 項`);
  return parts.join('・');
}

/** 結果頁的範圍說明；只有聚焦數少於初始數時才說「先從這 N 項了解」。不說排除或符合。 */
export function rangeLine(insight: InsightLike | null | undefined): string {
  if (!insight) return '';
  const initial = count(insight.initialCount);
  const remaining = count(insight.remainingCount);
  if (initial === null || remaining === null) return '';
  if (remaining < initial) return `依你的回答，從 ${initial} 項聚焦到 ${remaining} 項，先從這些了解`;
  return `目前聚焦 ${remaining} 項`;
}

/**
 * 回答後的溫和回饋：比較作答前後的「目前聚焦」數量。
 * 跳過不會當成「否」；數字沒變也如實說明，不假裝縮小。
 */
export function narrowingNote(before: number | null | undefined, after: number | null | undefined, skipped: boolean): string | null {
  if (skipped) return '已跳過，不會當成「否」。';
  const b = count(before);
  const a = count(after);
  if (b === null || a === null) return null;
  if (a < b) return `目前聚焦：${b} 項 → ${a} 項`;
  if (a === b) return '聚焦範圍沒有變，接著換個條件問。';
  return null;
}

/** 依序分組且不重複：同一 id 只留在第一個出現的組。各組長度即顯示的數量。 */
export function distinctGroups<T extends { id: string }>(groups: T[][]): T[][] {
  const seen = new Set<string>();
  return groups.map((list) =>
    list.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  );
}

/** 題目或選項上的選填說明欄位；只接受非空字串。 */
export function optionalText(source: unknown, key: string): string {
  if (!source || typeof source !== 'object') return '';
  const v = (source as Record<string, unknown>)[key];
  return typeof v === 'string' ? v.trim() : '';
}

/** 數字題的單位：題目有 unit 就用；年齡為「歲」；其餘為「數字」。 */
export function numberUnit(question: { field: string }): string {
  return optionalText(question, 'unit') || (question.field === 'age' ? '歲' : '數字');
}

const ELLIPSIS = '…';

/** 原文第一個非空句（以「。；;！？!?」或換行分句，不含分句標點）。沒有分句時回傳整段。 */
export function firstSentence(raw: string): string {
  return raw.split(/[。；;！？!?\n]/).map((part) => part.trim()).find(Boolean) ?? '';
}

/** 原文扣掉 part 後，是否還有標點與空白以外的內容。 */
function hasMore(full: string, part: string): boolean {
  const i = full.indexOf(part);
  const rest = i >= 0 ? full.slice(0, i) + full.slice(i + part.length) : full;
  return /[^\s。；;！？!?，、,]/.test(rest);
}

/** 補助內容原文：benefit.raw；沒有時用各金額條目的原文，以「；」串接。 */
export function benefitOriginal(item: Subsidy): string {
  const raw = text(item.benefit?.raw);
  if (raw) return raw;
  return (item.benefit?.amounts ?? [])
    .map((a) => (a && typeof a === 'object' ? text((a as Record<string, unknown>).raw) : ''))
    .filter(Boolean)
    .join('；');
}

/**
 * 詳情頁頂部的一句利益摘要：只取資料原文，不計算或補金額。
 * 取補助內容原文第一句，前面補上資料的類型短標（第一句已含時不重複）；
 * 沒有原文時只顯示類型短標。摘要只是原文一部分時以「…」結尾，完整原文另行顯示。
 */
export function benefitSummary(item: Subsidy): { text: string; partial: boolean } {
  const full = benefitOriginal(item);
  const kind = text(item.benefit?.kind) || text(item.classification?.benefit_type);
  const body = firstSentence(full);
  if (!body) return { text: kind, partial: false };
  const partial = hasMore(full, body);
  const head = kind && !body.includes(kind) ? `${kind}：${body}` : body;
  return { text: partial ? head + ELLIPSIS : head, partial };
}

/**
 * 步驟的一行摘要：先取第一句；超過 max 字時切在 max 字內最後一個「，、,」之前，
 * 找不到才在 max 字硬切。只要摘要不是完整原文就以「…」結尾，完整原文放在展開區。
 */
export function stepSummary(step: string, max = 40): { text: string; partial: boolean } {
  const full = step.trim();
  let s = firstSentence(full);
  const chars = [...s];
  if (chars.length > max) {
    let cut = -1;
    chars.slice(0, max).forEach((c, i) => {
      if ('，、,'.includes(c) && i > 0) cut = i;
    });
    s = chars.slice(0, cut > 0 ? cut : max).join('').trim();
  }
  const partial = hasMore(full, s);
  return { text: partial ? s + ELLIPSIS : s, partial };
}
