// 人工逐筆編輯的導讀，與官方原文分開。來源改變時停止顯示舊導讀。
import part1 from '../content/plain-language-1.json';
import part2 from '../content/plain-language-2.json';
import part3 from '../content/plain-language-3.json';
import part4 from '../content/plain-language-4.json';
import fingerprints from '../content/plain-language-sources.json';
import { fnv1a64 } from './catalog';
import type { Subsidy } from './types';

export interface PlainLanguage {
  audience: string;
  support: string;
  firstStep: string;
  cautions: string[];
}
export const plainLanguageEntries: Record<string, PlainLanguage> = { ...part1, ...part2, ...part3, ...part4 };
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, v]) => [key, stable(v)]));
  return value;
}
export function sourceFingerprint(item: Subsidy): string {
  const { name, eligibility, benefit, application, extensions, source_meta } = item;
  return fnv1a64(JSON.stringify(stable({ name, eligibility, benefit, application, extensions, source_meta })));
}
// Catalog 項目唯讀；每個物件只驗一次，避免長清單重複計算表單欄位。
const cache = new WeakMap<Subsidy, PlainLanguage | null>();
export function plainLanguageFor(item: Subsidy): PlainLanguage | null {
  if (cache.has(item)) return cache.get(item)!;
  const expected = (fingerprints as Record<string, string>)[item.id];
  const entry = expected && expected === sourceFingerprint(item) ? plainLanguageEntries[item.id] ?? null : null;
  cache.set(item, entry);
  return entry;
}
