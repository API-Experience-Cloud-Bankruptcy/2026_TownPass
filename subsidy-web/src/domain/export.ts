// ActionPlanExporter：行動單與求助文字。畫面、純文字、列印共用同一份內容。
// 預設不含任何個人條件；使用者可在預覽中選擇加入或移除。

import { mergeDocuments, OTHER_REGION_TITLE, regionText } from './documents';
import { FIT_LABEL, text } from './match';
import { buildRoute, SOURCE_KIND_LABEL, STATUS_LABEL, stuckAdvice, STUCK_OPTIONS, type StuckReason } from './route';
import type { MatchResult, Subsidy, Target } from './types';

export const DISCLAIMER = '申辦準備摘要，非核准或送件證明。資格以主管機關審核為準。';

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
    lines.push('已填條件（使用者自行填寫，未經查證）：');
    for (const c of input.conditions) lines.push(`- ${c.line}`);
  } else {
    lines.push('已填條件：未加入（本摘要不含個人填答）');
  }
  lines.push('');

  items.forEach((item, i) => {
    const route = buildRoute(item, input.region);
    const result = results.get(item.id);
    lines.push(`【${i + 1}】${item.name}`);
    if (result) {
      lines.push(`初篩：${FIT_LABEL[result.fit]}`);
      const blocked = disclosedLines(result, 'blocked_by', fields);
      if (blocked.length) {
        lines.push('不符原因：');
        for (const b of blocked) lines.push(`  - ${b}`);
      }
      const reasons = disclosedLines(result, 'reasons', fields);
      if (reasons.length) {
        lines.push('已知相符的單項：');
        for (const r of reasons) lines.push(`  - ${r}`);
      }
      const warnings = disclosedLines(result, 'warnings', fields);
      if (warnings.length) {
        lines.push('提醒（含資料時效）：');
        for (const w of warnings) lines.push(`  - ${w}`);
      }
    }
    if (text(item.benefit?.raw)) lines.push(`內容：${text(item.benefit?.raw)}`);
    if (route.agency) lines.push(`主管／承辦：${route.agency}`);
    if (route.channel) lines.push(`受理窗口（原文）：${route.channel}`);
    if (route.methods.length) lines.push(`辦理方式：${route.methods.join('、')}`);
    if (route.deadline) lines.push(`期限：${route.deadline}`);
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

  const merged = mergeDocuments(items, input.region);
  lines.push('文件準備清單（勾選僅代表自己準備，不代表已送件）：');
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

export interface HelpInput {
  meta: ExportMeta;
  target: Target;
  reason: StuckReason;
  item: Subsidy | null;
  stepText?: string;
  conditions: ConditionEntry[];
}

export function buildHelpText(input: HelpInput): string {
  const label = STUCK_OPTIONS.find((o) => o.id === input.reason)?.label ?? '';
  const lines: string[] = [];
  lines.push(input.target === 'self' ? '我需要協助' : '我正在替家人或其他人詢問');
  lines.push(`遇到的問題：${label}`);
  if (input.item) {
    const advice = stuckAdvice(input.item, input.reason, input.stepText);
    lines.push(`想申請：${input.item.name}`);
    if (input.stepText) lines.push(`卡住的步驟：${input.stepText}`);
    lines.push('');
    lines.push('可以這樣詢問：');
    lines.push(advice.askText);
    if (advice.found.length) {
      lines.push('');
      lines.push('資料列出的資訊：');
      for (const f of advice.found) lines.push(`- ${f}`);
    }
    for (const n of advice.notFound) lines.push(`- ${n}`);
    const route = buildRoute(input.item);
    for (const l of route.links.filter((x) => x.kind === 'program')) lines.push(`${l.label}（${SOURCE_KIND_LABEL[l.sourceKind]}）：${l.url}`);
  } else {
    lines.push('');
    lines.push('可以這樣詢問：');
    lines.push(`您好，我在申請福利時遇到困難（${label}），請問可以協助我了解下一步嗎？`);
  }
  if (input.conditions.length) {
    lines.push('');
    lines.push('補充條件（自行填寫，未經查證）：');
    for (const c of input.conditions) lines.push(`- ${c.line}`);
  }
  lines.push('');
  lines.push(`${DISCLAIMER}（${formatDate(input.meta.generatedAt)}，資料版本 ${input.meta.catalogVersion}）`);
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
