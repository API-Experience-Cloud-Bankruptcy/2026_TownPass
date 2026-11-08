// 只整理原文的閱讀順序與段落，不摘要、推論或改寫資格。
import type { Subsidy } from './types';

/** 保留所有字元，只在原有換行及中文句／分句末分段。短原文維持一段。 */
export function sourceParagraphs(raw: string): string[] {
  if (!raw) return [];
  const paragraphs: string[] = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const length = i + 1 - start;
    if (raw[i] === '\n' || length >= 100 && /[。！？；]/.test(raw[i]!)) {
      paragraphs.push(raw.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < raw.length) paragraphs.push(raw.slice(start));
  return paragraphs;
}

const RULE_GROUPS = [
  ['age', '年齡'], ['income', '所得'], ['household', '家庭與身分'],
  ['residence', '戶籍與居住'], ['student', '就學'], ['employment', '工作與投保'],
  ['disability', '身心障礙'], ['nationality', '國籍'], ['property', '財產'],
] as const;

export interface SourceConditionGroup { label: string; entries: string[] }

/** raw_summary 以外的每一條資格、排除與擴充原文均照列，不把分組視為初篩結果。 */
export function sourceConditions(item: Subsidy): SourceConditionGroup[] {
  const groups: SourceConditionGroup[] = RULE_GROUPS.map(([key, label]) => ({
    label,
    entries: item.eligibility[key].flatMap(rule => typeof rule.raw === 'string' && rule.raw.trim() ? [rule.raw] : []),
  }));
  groups.push({ label: '不能申請或不能重複領取的情形', entries: item.eligibility.exclusions.filter(s => s.trim()) });
  for (const extension of item.extensions ?? []) {
    if (typeof extension.raw === 'string' && extension.raw.trim()) {
      const prefix = extension.namespace === 'benefit' ? '給付補充' : extension.namespace === 'application' ? '辦理補充' : '條件補充';
      groups.push({ label: extension.label ? `${prefix}：${extension.label}` : prefix, entries: [extension.raw] });
    }
  }
  return groups.filter(group => group.entries.length);
}
