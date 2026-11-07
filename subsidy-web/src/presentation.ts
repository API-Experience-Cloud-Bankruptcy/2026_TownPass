// 畫面用的白話標示。只轉換既有資料與 MatchResult 欄位，不產生新規則或摘要文字。

import { text } from './domain/match';
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
