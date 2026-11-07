// SPDX-License-Identifier: AGPL-3.0-only
// Shared, source-bound review decisions. No runtime parsing of Chinese AND/OR.
import { EXTRA_QUALIFICATION_FIELDS, validExtraRuleValues, validExtraValue } from './answer-fields';
import manifest from '../../../backend/rules/eligibility-reviewed.json';
import { fnv1a64 } from './catalog';
import type { Answers, Subsidy } from './types';

export type ReviewedField = 'age' | 'region' | 'is_student' | 'household_type' | 'education_level' | 'employment_status' | 'housing_status' | 'care_context' | 'disability_certificate' | 'is_unemployed' | 'is_renting' | 'owns_home';
export interface Requirement {
  field: ReviewedField;
  label: string;
  evidence: { path: string; value: string }[];
  basis?: string;
  min?: number | null;
  max?: number | null;
  min_inclusive?: boolean;
  max_inclusive?: boolean;
  birth_year_min?: number;
  birth_year_max?: number;
  reference_year?: number;
  reference_date?: string;
  required_boolean?: boolean;
  values?: string[];
}
export interface ReviewedRecord {
  id: string;
  name: string;
  source_fingerprint: string;
  age_review: string;
  review_note: string;
  source_urls: string[];
  requirements: Requirement[];
}

/** Sort object keys, preserve array order and all unknown values. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(k => (value as Record<string, unknown>)[k] !== undefined).sort()
      .map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
export const sourceFingerprint = (item: unknown): string => fnv1a64(canonical(item));
export const REVIEW_VERSION = `${manifest.version}-${sourceFingerprint(manifest)}`;
export const reviewedRecords = manifest.records as ReviewedRecord[];
const reviews = new Map(reviewedRecords.map(r => [r.id, r]));
export function reviewFor(item: Subsidy): ReviewedRecord | null {
  const row = reviews.get(item.id);
  if (!row || row.source_fingerprint !== sourceFingerprint(item)) return null;
  if (row.requirements.length && (!row.source_urls.length || row.source_urls.some(url =>
    !item.source_meta?.sources?.some(source => source.type === 'official' && source.url === url)))) return null;
  for (const rule of row.requirements) for (const e of rule.evidence) {
    const value = e.path.split('/').slice(1).reduce<unknown>((v, k) =>
      v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined, item);
    if (value !== e.value) return null;
  }
  return row;
}

export function taipeiToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const p = (type: string) => parts.find(x => x.type === type)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')}`;
}
export function dateParts(today: string): [number, number, number] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && y <= 2200 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? [y, m, d] : null;
}
function within(n: number, r: Requirement): boolean {
  return (r.min == null || (r.min_inclusive === false ? n > r.min : n >= r.min)) &&
    (r.max == null || (r.max_inclusive === false ? n < r.max : n <= r.max));
}
function consensus(values: boolean[]): boolean | null {
  return values.every(Boolean) ? true : values.every(v => !v) ? false : null;
}
const COUNTIES = new Set(['臺北市','新北市','桃園市','臺中市','臺南市','高雄市','基隆市','新竹市','嘉義市','新竹縣','苗栗縣','彰化縣','南投縣','雲林縣','嘉義縣','屏東縣','宜蘭縣','花蓮縣','臺東縣','澎湖縣','金門縣','連江縣']);
export function requirementVerdict(rule: Requirement, answers: Answers, today: string): boolean | null {
  if (rule.field === 'is_student') return answers.is_student === undefined ? null : answers.is_student === rule.required_boolean;
  if (rule.field === 'household_type') return answers.household_type === undefined ? null : !!rule.values?.includes(answers.household_type);
  if (rule.field === 'region') {
    const region = answers.region?.trim().replace(/台/g, '臺');
    if (region === '其他縣市') return rule.values?.length === 1 && rule.values[0] === '臺北市' ? false : null;
    return !region || !COUNTIES.has(region) ? null : !!rule.values?.includes(region);
  }
  if (rule.field !== 'age') {
    if(!EXTRA_QUALIFICATION_FIELDS.has(rule.field)) return null;
    const value = answers.extra?.[rule.field];
    if(!validExtraValue(rule.field,value)) return null;
    if (value === undefined) return null;
    if (rule.required_boolean !== undefined) return typeof value === 'boolean' ? value === rule.required_boolean : null;
    return typeof value === 'string' && rule.values && validExtraRuleValues(rule.field,rule.values) ? rule.values.includes(value) : null;
  }
  const age = answers.age;
  if (age === undefined || !Number.isFinite(age) || age < 0 || age > 130) return null;
  if (rule.basis === 'current_age') return within(age, rule);
  if (rule.basis === 'future_event') {
    // An unknown future opening date cannot confirm the lower bound or a pass.
    return rule.max != null && (rule.max_inclusive === false ? age >= rule.max : age > rule.max) ? false : null;
  }
  const date = dateParts(today);
  if (!date || !Number.isInteger(age)) return null;
  const [year, month, day] = date;
  const birthYears = month === 12 && day === 31 ? [year - age] : [year - age - 1, year - age];
  if (rule.basis === 'birth_year') {
    if (rule.reference_year == null || rule.reference_year < 1900 || rule.reference_year > 2200) return null;
    return consensus(birthYears.map(y => (rule.birth_year_min == null || y >= rule.birth_year_min) && (rule.birth_year_max == null || y <= rule.birth_year_max)));
  }
  if (rule.basis === 'calendar_age') return consensus(birthYears.map(y => within(year - y, rule)));
  if (rule.basis === 'reference_date' && rule.reference_date) {
    const reference = dateParts(rule.reference_date);
    if (!reference) return null;
    // Use a superset of possible birthdays in the two birth years. This may
    // leave extra boundary cases unknown, but cannot wrongly exclude a birthday.
    const youngest = reference[0] - Math.max(...birthYears) - (reference[1] === 12 && reference[2] === 31 ? 0 : 1);
    const oldest = reference[0] - Math.min(...birthYears);
    const ages = Array.from({ length: oldest - youngest + 1 }, (_, n) => youngest + n);
    return consensus(ages.map(n => within(n, rule)));
  }
  return null;
}
export function reviewedChecks(item: Subsidy, answers: Answers, today = taipeiToday(), review = reviewFor(item)): { rule: Requirement; verdict: boolean | null }[] {
  return (review?.requirements ?? []).map(rule => ({ rule, verdict: requirementVerdict(rule, answers, today) }));
}
