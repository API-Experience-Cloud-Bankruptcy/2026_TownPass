// 行動單文件合併：地域及原文要求相同才合併；地方文件不推廣為全國必備。
import { adaptiveReviewFor } from './adaptive';
import { text } from './match';
import type { Answers, DocumentRegionBasis, RequiredDocument, Subsidy } from './types';

export const DOCUMENT_REGION_BASIS_LABEL: Record<DocumentRegionBasis, string> = {
  registered: '戶籍地', residence: '實際居住地', application: '受理縣市', unknown: '地區依據待確認',
};
export const DOCUMENT_REGION_NOTICE = '地方文件僅供核對原文，不能據此判定其他縣市的文件要求；未列出當地文件不代表免附文件。戶籍地不代替實際居住地或受理縣市。';
const COUNTIES = new Set(['臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '嘉義市', '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣', '臺東縣', '澎湖縣', '金門縣', '連江縣']);
function exactRegion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/台/g, '臺');
  return COUNTIES.has(normalized) ? normalized : undefined;
}

export interface DocumentProjection {
  documents: RequiredDocument[];
  pendingDocuments: RequiredDocument[];
  otherDocuments: RequiredDocument[];
  notices: string[];
}
/** 原始文件及既有人工覆核保留，地域投影不修改 catalog。 */
export function effectiveDocuments(item: Subsidy): RequiredDocument[] {
  const overrides = adaptiveReviewFor(item)?.document_overrides ?? [];
  return (item.application?.required_documents ?? []).map((doc, index) => {
    const overlay = overrides.find(o => o.index === index);
    return overlay ? { ...doc, required: overlay.required, condition: overlay.condition, notes: [doc.notes, overlay.notes].filter(Boolean).join('；') } : doc;
  });
}
export function documentRegionLabel(doc: Pick<RequiredDocument, 'regions' | 'region_basis'>): string {
  return doc.regions?.length ? `${doc.regions.join('、')}（${DOCUMENT_REGION_BASIS_LABEL[doc.region_basis ?? 'unknown']}）` : '';
}
/** 僅依結構化範圍與同一依據的確切縣市回答比對；「其他縣市」並非確切地區。 */
export function projectDocuments(item: Subsidy, answers: Answers = {}): DocumentProjection {
  const projection: DocumentProjection = { documents: [], pendingDocuments: [], otherDocuments: [], notices: [] };
  for (const doc of effectiveDocuments(item).filter(d => text(d?.name))) {
    if (!doc.regions?.length || doc.regions.includes('全國')) { projection.documents.push(doc); continue; }
    const value = doc.region_basis === 'registered' ? answers.region
      : doc.region_basis === 'residence' ? answers.extra?.residence_region
      : doc.region_basis === 'application' ? answers.extra?.application_region : undefined;
    const region = exactRegion(value);
    if (!region) projection.pendingDocuments.push(doc);
    else if (doc.regions.some(r => exactRegion(r) === region)) projection.documents.push(doc);
    else projection.otherDocuments.push(doc);
  }
  if (projection.pendingDocuments.length || projection.otherDocuments.length) projection.notices.push(DOCUMENT_REGION_NOTICE);
  if (!projection.documents.length && effectiveDocuments(item).length) projection.notices.push('目前沒有可確認適用的文件清單，請向實際受理窗口核對。');
  return projection;
}

export interface MergedDocument {
  key: string;
  name: string;
  condition: string;
  notes: string;
  required: boolean | null;
  regions?: string[];
  region_basis?: DocumentRegionBasis;
  region_evidence?: string;
  usedBy: { id: string; name: string }[];
  hasVariant: boolean;
}
export interface MergeResult {
  documents: MergedDocument[];
  pendingDocuments: MergedDocument[];
  otherDocuments: MergedDocument[];
  notices: string[];
  incomplete: { id: string; name: string }[];
}
export function documentKey(name: string, condition: string, notes: string, required: boolean | null, regions?: string[], basis?: DocumentRegionBasis, evidence?: string): string {
  const key: unknown[] = [name, condition, notes, required];
  // 共通文件沿用原 key；地方要求不同時不可共用勾選狀態。
  if (regions?.length) key.push([...regions].sort(), basis ?? 'unknown', evidence ?? '');
  return JSON.stringify(key);
}
export function mergeDocuments(items: Subsidy[], answers: Answers = {}): MergeResult {
  const maps = { documents: new Map<string, MergedDocument>(), pendingDocuments: new Map<string, MergedDocument>(), otherDocuments: new Map<string, MergedDocument>() };
  const incomplete: MergeResult['incomplete'] = [];
  const notices = new Set<string>();
  for (const item of items) {
    const projected = projectDocuments(item, answers);
    if (!effectiveDocuments(item).some(d => text(d?.name))) incomplete.push({ id: item.id, name: item.name });
    projected.notices.forEach(notice => notices.add(notice));
    for (const group of ['documents', 'pendingDocuments', 'otherDocuments'] as const) {
      for (const d of projected[group]) {
        const name = text(d.name);
        const condition = text(d.condition) === name ? '' : text(d.condition);
        const notes = text(d.notes);
        const required = typeof d.required === 'boolean' ? d.required : null;
        const key = documentKey(name, condition, notes, required, d.regions, d.region_basis, d.region_evidence);
        const existing = maps[group].get(key);
        if (existing) {
          if (!existing.usedBy.some(u => u.id === item.id)) existing.usedBy.push({ id: item.id, name: item.name });
        } else maps[group].set(key, { key, name, condition, notes, required, regions: d.regions, region_basis: d.region_basis, region_evidence: d.region_evidence, usedBy: [{ id: item.id, name: item.name }], hasVariant: false });
      }
    }
  }
  const all = Object.values(maps).flatMap(map => [...map.values()]);
  const counts = new Map<string, number>();
  for (const d of all) counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
  for (const d of all) d.hasVariant = (counts.get(d.name) ?? 0) > 1;
  const sorted = (map: Map<string, MergedDocument>) => [...map.values()].sort((a, b) => b.usedBy.length - a.usedBy.length || a.name.localeCompare(b.name, 'zh-Hant'));
  return { documents: sorted(maps.documents), pendingDocuments: sorted(maps.pendingDocuments), otherDocuments: sorted(maps.otherDocuments), incomplete, notices: [...notices] };
}
