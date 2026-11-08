import { projectDocuments } from './documents';
import { deadlineSummary } from './deadline';
// JourneyBuilder：只用資料原文組合辦理路線，不自行發明窗口、電話或地址。

import { text } from './match';
import type { Answers, RequiredDocument, Subsidy } from './types';
import { safeUrl } from './url';

export const METHOD_LABEL: Record<string, string> = {
  in_person: '臨櫃辦理',
  online: '線上申請',
  mail: '郵寄',
  school: '透過學校',
  institution: '透過機構或院所',
  agent: '可委託他人',
  automatic: '主動核給（依原文）',
  other: '其他方式',
};

export type LinkKind = 'program' | 'apply' | 'form';
export type SourceKind = 'official' | 'third_party' | 'other' | 'unknown';

export interface RouteLink {
  kind: LinkKind;
  label: string;
  url: string;
  /** 依 source_meta.sources 的 type 判定；找不到對應來源為 unknown，不預設官方 */
  sourceKind: SourceKind;
}

export interface RouteSource {
  url: string;
  role: string;
  type: string;
  checkedDate: string;
  sourceDate: string;
}

export interface Route {
  steps: string[];
  /** true：原文以箭頭分步；false：原文未分步，整段顯示 */
  splitFromArrow: boolean;
  agency: string;
  channel: string;
  methods: string[];
  documents: RequiredDocument[];
  pendingDocuments: RequiredDocument[];
  otherDocuments: RequiredDocument[];
  notices: string[];
  links: RouteLink[];
  sources: RouteSource[];
  rejectedUrls: number;
  deadline: string;
  deadlineSummary: string;
  applicationStatus: string;
  checkedDate: string;
  status: string;
  missing: string[];
}

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  official: '官方來源',
  third_party: '第三方來源',
  other: '其他來源',
  unknown: '來源類型未標示',
};

const LINK_LABEL: Record<LinkKind, { official: string; other: string }> = {
  program: { official: '官方說明頁', other: '來源說明' },
  apply: { official: '官方申請入口', other: '申請入口' },
  form: { official: '官方表單下載', other: '表單下載' },
};

function toSourceKind(type: unknown): SourceKind {
  return type === 'official' || type === 'third_party' || type === 'other' ? type : 'unknown';
}

/** 僅在原文含明確箭頭時拆分步驟。 */
export function splitProcess(process: unknown): { steps: string[]; split: boolean } {
  const raw = text(process);
  if (!raw) return { steps: [], split: false };
  if (!/→|->|⇒/.test(raw)) return { steps: [raw], split: false };
  const steps = raw
    .split(/→|->|⇒/)
    .map((s) => s.trim())
    .filter(Boolean);
  return { steps, split: steps.length > 1 };
}

export function buildRoute(item: Subsidy, answers: Answers = {}): Route {
  const app = item.application ?? ({} as Subsidy['application']);
  const { steps, split } = splitProcess(app.process_text);
  let rejected = 0;
  const sourceTypes = new Map<string, string>();
  for (const s of item.source_meta?.sources ?? []) {
    const u = safeUrl(s?.url);
    if (u) sourceTypes.set(u, s.type);
  }
  const links: RouteLink[] = [];
  for (const kind of ['program', 'apply', 'form'] as const) {
    const rawUrl = app.urls?.[kind];
    if (rawUrl === null || rawUrl === undefined || rawUrl === '') continue;
    const url = safeUrl(rawUrl);
    if (!url) {
      rejected += 1;
      continue;
    }
    const sourceKind = toSourceKind(sourceTypes.get(url));
    const names = LINK_LABEL[kind];
    links.push({ kind, label: sourceKind === 'official' ? names.official : names.other, url, sourceKind });
  }
  const sources: RouteSource[] = [];
  for (const s of item.source_meta?.sources ?? []) {
    const url = safeUrl(s?.url);
    if (!url) {
      if (s?.url) rejected += 1;
      continue;
    }
    sources.push({
      url,
      role: text(s.role),
      type: text(s.type),
      checkedDate: text(s.checked_date) || text(item.source_meta?.checked_date),
      sourceDate: text(s.source_date),
    });
  }
  const agency = text(app.agency) || text(item.provider?.name);
  const channel = text(app.channel_text);
  const projection = projectDocuments(item, answers);
  const { documents } = projection;
  const missing: string[] = [];
  if (steps.length === 0) missing.push('辦理步驟原文未提供，請向窗口確認。');
  if (!channel) missing.push('受理窗口原文未提供，請以官方網站為準。');
  if (documents.length === 0) missing.push('適用文件清單尚未確認，不代表免附文件。');
  // 資料沒有獨立的電話、地址欄位；不從原文推測是否已提供。
  missing.push('電話與地址請依受理窗口原文或來源網站確認。');
  if (links.length === 0) missing.push('資料未提供可用的說明或申請網址，請向承辦單位確認。');
  return {
    steps,
    splitFromArrow: split,
    agency,
    channel,
    methods: (app.methods ?? []).map((m) => METHOD_LABEL[m] ?? m),
    ...projection,
    links,
    sources,
    rejectedUrls: rejected,
    deadline: text(app.deadline?.raw),
    deadlineSummary: deadlineSummary(item),
    applicationStatus: text(item.source_meta?.application_status),
    checkedDate: text(item.source_meta?.checked_date),
    status: text(item.source_meta?.verification_status),
    missing,
  };
}

export const SOURCE_ROLE: Record<string, string> = {
  program: '方案說明',
  apply: '申請入口',
  form: '表單',
  supplementary: '補充資料',
};

export const STATUS_LABEL: Record<string, string> = {
  verified: '資料標示為已查核',
  partial: '資料標示為部分查核',
  unverified: '資料標示為未查核',
};

/** 申請準備 PDF 的窗口詢問文字。 */
export function applicationInquiry(item: Subsidy, target: 'self' | 'other'): string {
  return `您好，我想了解「${item.name}」。請問${target === 'other' ? '對方' : '我'}是否符合申請資格？辦理要怎麼做？`;
}
