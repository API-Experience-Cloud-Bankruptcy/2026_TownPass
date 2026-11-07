// 行動單文件合併：只有名稱、條件、備註、必要性與適用縣市完全相同才合併；同名但要求不同者分列並標示。

import { adaptiveReviewFor } from './adaptive';
import { text } from './match';
import type { RequiredDocument, Subsidy } from './types';

export interface MergedDocument {
  key: string;
  name: string;
  condition: string;
  notes: string;
  required: boolean | null;
  /** 文件只適用的縣市；空陣列代表資料未限定縣市 */
  regions: string[];
  usedBy: { id: string; name: string }[];
  /** 同名但條件不同，另列一項 */
  hasVariant: boolean;
}

export interface MergeResult {
  documents: MergedDocument[];
  /** 未回答戶籍或無法判斷縣市時，只適用其他縣市的文件另列，不併入主清單 */
  otherRegion: MergedDocument[];
  /** 沒有適用文件的資源（不代表免附） */
  incomplete: { id: string; name: string }[];
}

/** 與 backend/data/subsidies.schema.json 的 document.regions 列舉一致。 */
export const COUNTIES = ['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '嘉義市', '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣'] as const;

export const OTHER_REGION_TITLE = '其他縣市的規定';

const normalizeCounty = (value: string) => value.trim().replace(/台/g, '臺');

export function documentRegions(doc: RequiredDocument): string[] {
  return Array.isArray(doc?.regions) ? doc.regions.filter((r): r is string => typeof r === 'string' && !!r.trim()).map(normalizeCounty) : [];
}

export type DocumentRegionFit = 'applies' | 'other_region' | 'excluded';

/**
 * 依查詢對象回答的戶籍判斷文件是否適用。未限定縣市一律適用；
 * 未回答或只知「臺北市以外」時無法確定，另列；已知縣市且不在適用清單內則不列。
 */
export function documentRegionFit(doc: RequiredDocument, region?: string): DocumentRegionFit {
  const regions = documentRegions(doc);
  if (!regions.length) return 'applies';
  const answered = region === undefined ? '' : normalizeCounty(region);
  if (!answered) return 'other_region';
  if (regions.includes(answered)) return 'applies';
  return (COUNTIES as readonly string[]).includes(answered) ? 'excluded' : 'other_region';
}

export function documentKey(name: string, condition: string, notes: string, required: boolean | null, regions: string[] = []): string {
  return JSON.stringify(regions.length ? [name, condition, notes, required, regions] : [name, condition, notes, required]);
}

export function effectiveDocuments(item:Subsidy):Subsidy['application']['required_documents'] {
  const overrides=adaptiveReviewFor(item)?.document_overrides??[];
  return (item.application?.required_documents??[]).map((doc,index)=> {
    const overlay=overrides.find(o=>o.index===index);
    return overlay?{...doc,required:overlay.required,condition:overlay.condition,notes:[doc.notes,overlay.notes].filter(Boolean).join('；')}:doc;
  });
}

/** 依戶籍分出適用文件與其他縣市文件；不適用者不回傳。 */
export function documentsForRegion(item: Subsidy, region?: string): { documents: RequiredDocument[]; otherRegion: RequiredDocument[] } {
  const documents: RequiredDocument[] = [];
  const otherRegion: RequiredDocument[] = [];
  for (const doc of effectiveDocuments(item)) {
    if (!text(doc?.name)) continue;
    const fit = documentRegionFit(doc, region);
    if (fit === 'applies') documents.push(doc);
    else if (fit === 'other_region') otherRegion.push(doc);
  }
  return { documents, otherRegion };
}

function mergeInto(map: Map<string, MergedDocument>, item: Subsidy, d: RequiredDocument) {
  const name = text(d.name);
  const condition = text(d.condition) === name ? '' : text(d.condition);
  const notes = text(d.notes);
  const required = typeof d.required === 'boolean' ? d.required : null;
  const regions = documentRegions(d);
  const key = documentKey(name, condition, notes, required, regions);
  const existing = map.get(key);
  if (existing) {
    if (!existing.usedBy.some((u) => u.id === item.id)) existing.usedBy.push({ id: item.id, name: item.name });
  } else {
    map.set(key, { key, name, condition, notes, required, regions, usedBy: [{ id: item.id, name: item.name }], hasVariant: false });
  }
}

function finish(map: Map<string, MergedDocument>): MergedDocument[] {
  const documents = [...map.values()];
  const counts = new Map<string, number>();
  for (const d of documents) counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
  for (const d of documents) d.hasVariant = (counts.get(d.name) ?? 0) > 1;
  documents.sort((a, b) => b.usedBy.length - a.usedBy.length || a.name.localeCompare(b.name, 'zh-Hant'));
  return documents;
}

export function mergeDocuments(items: Subsidy[], region?: string): MergeResult {
  const main = new Map<string, MergedDocument>();
  const other = new Map<string, MergedDocument>();
  const incomplete: MergeResult['incomplete'] = [];
  for (const item of items) {
    const { documents, otherRegion } = documentsForRegion(item, region);
    if (documents.length === 0) incomplete.push({ id: item.id, name: item.name });
    for (const d of documents) mergeInto(main, item, d);
    for (const d of otherRegion) mergeInto(other, item, d);
  }
  return { documents: finish(main), otherRegion: finish(other), incomplete };
}

export function regionText(regions: string[]): string {
  return regions.length ? `適用：${regions.join('、')}` : '';
}
