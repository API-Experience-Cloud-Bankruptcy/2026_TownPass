// JourneyBuilder：只用資料原文組合辦理路線，不自行發明窗口、電話或地址。

import { text } from './match';
import type { RequiredDocument, Subsidy } from './types';
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
  links: RouteLink[];
  sources: RouteSource[];
  rejectedUrls: number;
  deadline: string;
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

export function buildRoute(item: Subsidy): Route {
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
  const documents = (app.required_documents ?? []).filter((d) => text(d?.name));
  const missing: string[] = [];
  if (steps.length === 0) missing.push('辦理步驟原文未提供，請向窗口確認。');
  if (!channel) missing.push('受理窗口原文未提供，請以官方網站為準。');
  if (documents.length === 0) missing.push('文件清單尚未補齊，不代表免附文件。');
  // 資料沒有獨立的電話、地址欄位；不從原文推測是否已提供。
  missing.push('電話與地址請依受理窗口原文或來源網站確認。');
  if (links.length === 0) missing.push('原文未提供可用的官方網址。');
  return {
    steps,
    splitFromArrow: split,
    agency,
    channel,
    methods: (app.methods ?? []).map((m) => METHOD_LABEL[m] ?? m),
    documents,
    links,
    sources,
    rejectedUrls: rejected,
    deadline: text(app.deadline?.raw),
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
  verified: '資料原有狀態：已查核',
  partial: '資料原有狀態：部分查核',
  unverified: '資料原有狀態：未查核',
};

export type StuckReason = 'documents' | 'visit' | 'helper' | 'online' | 'understand';

export const STUCK_OPTIONS: { id: StuckReason; label: string }[] = [
  { id: 'documents', label: '不知道怎麼取得文件' },
  { id: 'visit', label: '不方便到場' },
  { id: 'helper', label: '沒有人可以協助' },
  { id: 'online', label: '無法線上操作' },
  { id: 'understand', label: '看不懂要求' },
];

/** 原文明確、可不必到場的方式。 */
export const REMOTE_METHODS = ['online', 'mail', 'agent'];
/** 原文明確的非線上方式（學校、機構、其他不確定形式不列入）。 */
export const OFFLINE_METHODS = ['in_person', 'mail', 'agent'];

export interface StuckAdvice {
  found: string[];
  notFound: string[];
  askText: string;
}

/** 「這一步做不到」：只引用原文已列的替代方式；沒有就如實說明並給詢問文字。 */
export function stuckAdvice(item: Subsidy, reason: StuckReason, stepText?: string): StuckAdvice {
  const route = buildRoute(item);
  const methods = item.application?.methods ?? [];
  const found: string[] = [];
  const notFound: string[] = [];
  const where = route.channel || route.agency || '承辦單位';
  const step = stepText ? `「${stepText}」這一步` : '辦理';
  let ask = '';
  switch (reason) {
    case 'documents': {
      const withNotes = route.documents.filter((d) => text(d.notes) || text(d.condition));
      for (const d of withNotes) found.push(`${d.name}：${[text(d.condition), text(d.notes)].filter(Boolean).join('；')}`);
      if (withNotes.length === 0) notFound.push('原文未說明文件取得方式。');
      ask = `您好，我想申請「${item.name}」，請問${route.documents.map((d) => d.name).join('、') || '需要的文件'}要去哪裡申請或取得？有沒有可以代替的文件？`;
      break;
    }
    case 'visit': {
      // 只列原文明確的不需到場方式；透過學校或機構不代表不用親赴。
      const alt = methods.filter((m) => REMOTE_METHODS.includes(m));
      if (alt.length) found.push(`原文列出的方式：${alt.map((m) => METHOD_LABEL[m] ?? m).join('、')}（細節請向窗口確認）`);
      else notFound.push('原文未列出不需到場的辦理方式。');
      ask = `您好，我想申請「${item.name}」，但不方便到現場。請問${step}可以用郵寄、線上或委託他人辦理嗎？需要準備什麼？`;
      break;
    }
    case 'helper': {
      if (methods.includes('agent')) found.push('原文列出可委託他人辦理，委託文件請向窗口確認。');
      else notFound.push('原文未說明可委託他人或到宅服務。');
      ask = `您好，我想申請「${item.name}」，身邊沒有人可以協助。請問有沒有人可以協助我辦理，或可以用電話說明步驟？`;
      break;
    }
    case 'online': {
      const alt = methods.filter((m) => OFFLINE_METHODS.includes(m));
      if (alt.length) found.push(`原文列出的非線上方式：${alt.map((m) => METHOD_LABEL[m] ?? m).join('、')}`);
      else notFound.push('原文未列出明確的非線上方式。');
      ask = `您好，我想申請「${item.name}」，但不會使用網路申請。請問可以臨櫃或郵寄辦理嗎？`;
      break;
    }
    case 'understand': {
      const summary = text(item.eligibility?.raw_summary);
      if (summary) found.push(`適用對象原文：${summary}`);
      ask = `您好，我想了解「${item.name}」。請問我是否符合申請資格？${step}具體要做什麼？`;
      break;
    }
  }
  if (route.channel || route.agency) found.push(`可詢問：${where}`);
  else notFound.push('原文未提供窗口，請以官方網站為準。');
  return { found, notFound, askText: ask };
}
