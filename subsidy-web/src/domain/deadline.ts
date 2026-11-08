import reviewed from '../content/deadline-summaries.json';
import type { Subsidy } from './types';

type Deadline = Subsidy['application']['deadline'];
const summaries: Record<string, { source: Deadline; summary: string }> = reviewed;

/** 顯示層專用；不改動受理狀態或資格判斷。摘要只在期限來源完全相符時使用。 */
export function deadlineSummary(item: Subsidy): string {
  const deadline = item.application?.deadline;
  const entry = summaries[item.id];
  if (entry && deadline && ['type', 'start', 'end', 'raw'].every(key => entry.source[key] === deadline[key])) {
    return entry.summary;
  }
  const raw = deadline?.raw?.trim() ?? '';
  if (!raw && deadline?.type === 'fixed') {
    const date = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.replace(/-/g, '/') : '';
    const start = date(deadline.start);
    const end = date(deadline.end);
    if (start && end) return `${start}～${end}`;
    if (end) return `${end} 截止`;
    if (start) return `${start} 起受理`;
  }
  if (!raw || /^原文未擷取期限/.test(raw)) return '申請期限待確認';
  if (/^常態受理[，（]/.test(raw) && !/[；;]/.test(raw)) return '常態受理';
  if (/^依學校每學期/.test(raw)) return '依校內公告（校內期限可能較早）';
  if (/^未見統一年度截止日/.test(raw)) return '依資格與個案申辦';
  // 未審閱的新資料不抽取日期，避免把公告日或補件日當成申請截止日。
  if (raw.length <= 52) return raw;
  const clauses = raw.split(/(?<=[；。])/u);
  const first = clauses[0] ?? raw;
  return first.length <= 52 ? `${first.replace(/[；。]$/, '')}…` : `${raw.slice(0, 50)}…`;
}
