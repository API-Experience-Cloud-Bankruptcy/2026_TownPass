// ActionPlanExporter：行動單文字。畫面、純文字、列印共用同一份內容。
// 預設不含任何個人條件；使用者可在預覽中選擇加入或移除。

import { plainLanguageFor } from './plain-language';
import { mergeDocuments, OTHER_REGION_TITLE, regionText } from './documents';
import { FIT_LABEL, text } from './match';
import { buildRoute, SOURCE_KIND_LABEL, STATUS_LABEL } from './route';
import type { MatchResult, Subsidy, Target } from './types';

export const DISCLAIMER = '這份摘要供申請前準備，不代表已送件或核准。資格由主管機關審核。';

export interface ExportMeta {
  catalogVersion: string;
  sourceLabel: string;
  generatedAt: Date;
}

/** 使用者同意加入輸出的條件；field 對應答案欄位。 */
export interface ConditionEntry {
  field: string;
  line: string;
}

/**
 * 輸出用的結果訊息：含填答值的訊息只有在該欄位條件被勾選加入時才原樣輸出，
 * 否則改用不含填答值的替代文字（或略過）。
 */
export function disclosedLines(result: MatchResult, list: 'reasons' | 'warnings' | 'blocked_by', fields: Set<string>): string[] {
  const out: string[] = [];
  for (const line of result[list]) {
    const note = result.personal?.find((p) => p.list === list && p.text === line);
    const value = !note || fields.has(note.field) ? line : note.neutral;
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

export interface PlanInput {
  meta: ExportMeta;
  target: Target;
  items: Subsidy[];
  results: Map<string, MatchResult>;
  /** 使用者同意加入的條件（例：「年齡：72 歲」）；空陣列代表不含個人條件 */
  conditions: ConditionEntry[];
  docChecks: Record<string, boolean>;
  stepDone: Record<string, number[]>;
  /** 查詢對象回答的戶籍，只用於篩選文件，不輸出；未回答時其他縣市文件另列 */
  region?: string;
  documentAnswers?: import('./types').Answers;
}

function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function buildPlanText(input: PlanInput): string {
  const { meta, items, results } = input;
  const lines: string[] = [];
  lines.push('福利行動單');
  lines.push(DISCLAIMER);
  lines.push(`產生日期：${formatDate(meta.generatedAt)}`);
  lines.push(`資料來源：${meta.sourceLabel}`);
  lines.push(`對象：${input.target === 'self' ? '本人' : '家人或其他人'}`);
  const fields = new Set(input.conditions.map((c) => c.field));
  if (input.conditions.length) {
    lines.push('已加入的回答（自行填寫，尚未查證）：');
    for (const c of input.conditions) lines.push(`- ${c.line}`);
  } else {
    lines.push('已填條件：未加入（本摘要不含個人填答）');
  }
  lines.push('');

  items.forEach((item, i) => {
    const route = buildRoute(item, input.documentAnswers ?? { region: input.region });
    const result = results.get(item.id);
    lines.push(`【${i + 1}】${item.name}`);
    const guide = plainLanguageFor(item);
    if (guide) {
      lines.push('白話導讀（協助閱讀，完整條件請看下方原文）：');
      lines.push(`適合誰先了解：${guide.audience}`);
      lines.push(`可以獲得什麼：${guide.support}`);
      lines.push(`第一步：${guide.firstStep}`);
      for (const caution of guide.cautions) lines.push(`提醒：${caution}`);
      lines.push('');
    }
    if (result) {
      lines.push(`初篩：${FIT_LABEL[result.fit]}`);
      const blocked = disclosedLines(result, 'blocked_by', fields);
      if (blocked.length) {
        lines.push('不符原因：');
        for (const b of blocked) lines.push(`  - ${b}`);
      }
      const reasons = disclosedLines(result, 'reasons', fields);
      if (reasons.length) {
        lines.push('已符合的個別條件：');
        for (const r of reasons) lines.push(`  - ${r}`);
      }
      const warnings = disclosedLines(result, 'warnings', fields);
      if (warnings.length) {
        lines.push('提醒（包含資料是否仍適用）：');
        for (const w of warnings) lines.push(`  - ${w}`);
      }
    }
    if (text(item.benefit?.raw)) lines.push(`內容：${text(item.benefit?.raw)}`);
    // 導讀不能取代資格原文；即使尚無初篩結果，也完整保留來源列出的條件。
    const originals = new Set<string>();
    const collectOriginal = (value: unknown): void => {
      if (typeof value === 'string') { if (value.trim()) originals.add(value); }
      else if (Array.isArray(value)) value.forEach(collectOriginal);
      else if (value && typeof value === 'object') {
        const rule = value as Record<string, unknown>;
        for (const key of ['raw', 'notes', 'description', 'condition']) collectOriginal(rule[key]);
      }
    };
    for (const value of Object.values(item.eligibility ?? {})) collectOriginal(value);
    for (const extension of item.extensions ?? []) if (extension.namespace === 'eligibility') collectOriginal(extension.raw);
    if (originals.size) {
      lines.push('資格條件（原文）：');
      for (const original of originals) lines.push(`  - ${original}`);
    }
    if (route.agency) lines.push(`主管／承辦：${route.agency}`);
    if (route.channel) lines.push(`受理窗口（原文）：${route.channel}`);
    if (route.methods.length) lines.push(`辦理方式：${route.methods.join('、')}`);
    lines.push(`期限：${route.deadlineSummary}`);
    if (route.deadline && route.deadline !== route.deadlineSummary) lines.push(`完整期限說明：${route.deadline}`);
    if (route.steps.length) {
      lines.push(route.splitFromArrow ? '步驟：' : '流程（原文）：');
      const done = new Set(input.stepDone[item.id] ?? []);
      route.steps.forEach((s, n) => lines.push(`  ${done.has(n) ? '[已準備]' : '[ ]'} ${n + 1}. ${s}`));
    }
    if (result?.pending?.length) {
      lines.push('待確認：');
      for (const p of result.pending) lines.push(`  - ${p}`);
    }
    const notes = text(item.source_meta?.notes);
    const verification = text(item.source_meta?.verification_note);
    if (notes) lines.push(`資料備註：${notes}`);
    if (verification) lines.push(`查核說明：${verification}`);
    for (const m of route.missing) lines.push(`注意：${m}`);
    for (const l of route.links) lines.push(`${l.label}（${SOURCE_KIND_LABEL[l.sourceKind]}）：${l.url}`);
    lines.push(`${STATUS_LABEL[route.status] ?? `資料狀態：${route.status || '未註明'}`}；查核日期 ${route.checkedDate || '未註明'}`);
    lines.push('');
  });

  const merged = mergeDocuments(items, input.documentAnswers ?? { region: input.region });
  lines.push('文件準備清單（勾選代表已準備，不代表已送件）：');
  for (const d of merged.documents) {
    const mark = input.docChecks[d.key] ? '[已準備]' : '[ ]';
    const detail = [d.required === false && '非必備（依個案需要）', d.condition && `條件：${d.condition}`, d.notes && `備註：${d.notes}`].filter(Boolean).join('；');
    lines.push(`${mark} ${d.name}${detail ? `（${detail}）` : ''}`);
    lines.push(`    用於：${d.usedBy.map((u) => u.name).join('、')}`);
  }
  for (const m of merged.incomplete) lines.push(`注意：「${m.name}」文件清單尚未補齊，不代表免附文件。`);
  if (merged.otherRegion.length) {
    lines.push('');
    lines.push(`${OTHER_REGION_TITLE}：`);
    for (const d of merged.otherRegion) {
      const mark = input.docChecks[d.key] ? '[已準備]' : '[ ]';
      const detail = [regionText(d.regions), d.required === false && '非必備（依個案需要）', d.condition && `條件：${d.condition}`, d.notes && `備註：${d.notes}`].filter(Boolean).join('；');
      lines.push(`${mark} ${d.name}（${detail}）`);
      lines.push(`    用於：${d.usedBy.map((u) => u.name).join('、')}`);
    }
  }
  lines.push('');
  lines.push(DISCLAIMER);
  lines.push(`資料版本：${meta.catalogVersion}`);
  return lines.join('\n');
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed';

/** 系統分享：區分使用者取消與真正錯誤。 */
export async function shareText(title: string, body: string, nav: Partial<Navigator> = globalThis.navigator ?? {}): Promise<ShareOutcome> {
  if (typeof nav.share !== 'function') return 'unsupported';
  try {
    await nav.share({ title, text: body });
    return 'shared';
  } catch (error) {
    return (error as Error)?.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

export async function copyText(body: string, nav: Partial<Navigator> = globalThis.navigator ?? {}): Promise<boolean> {
  try {
    if (!nav.clipboard?.writeText) return false;
    await nav.clipboard.writeText(body);
    return true;
  } catch {
    return false;
  }
}

/** 下載純文字檔；回傳是否成功觸發（WebView 可能不支援，需提供可選取文字備援）。 */
export function downloadText(filename: string, body: string): boolean {
  try {
    const blob = new Blob([`﻿${body}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}
