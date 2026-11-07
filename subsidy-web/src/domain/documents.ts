// 行動單文件合併：只有名稱、條件、備註、必要性完全相同才合併；同名但要求不同者分列並標示。

import { adaptiveReviewFor } from './adaptive';
import { text } from './match';
import type { Subsidy } from './types';

export interface MergedDocument {
  key: string;
  name: string;
  condition: string;
  notes: string;
  required: boolean | null;
  usedBy: { id: string; name: string }[];
  /** 同名但條件不同，另列一項 */
  hasVariant: boolean;
}

export interface MergeResult {
  documents: MergedDocument[];
  /** 文件清單空白的資源（不代表免附） */
  incomplete: { id: string; name: string }[];
}

export function documentKey(name: string, condition: string, notes: string, required: boolean | null): string {
  return JSON.stringify([name, condition, notes, required]);
}

export function effectiveDocuments(item:Subsidy):Subsidy['application']['required_documents'] {
  const overrides=adaptiveReviewFor(item)?.document_overrides??[];
  return (item.application?.required_documents??[]).map((doc,index)=> {
    const overlay=overrides.find(o=>o.index===index);
    return overlay?{...doc,required:overlay.required,condition:overlay.condition,notes:[doc.notes,overlay.notes].filter(Boolean).join('；')}:doc;
  });
}

export function mergeDocuments(items: Subsidy[]): MergeResult {
  const map = new Map<string, MergedDocument>();
  const incomplete: MergeResult['incomplete'] = [];
  for (const item of items) {
    const docs = effectiveDocuments(item).filter((d) => text(d?.name));
    if (docs.length === 0) incomplete.push({ id: item.id, name: item.name });
    for (const d of docs) {
      const name = text(d.name);
      const condition = text(d.condition) === name ? '' : text(d.condition);
      const notes = text(d.notes);
      const required = typeof d.required === 'boolean' ? d.required : null;
      const key = documentKey(name, condition, notes, required);
      const existing = map.get(key);
      if (existing) {
        if (!existing.usedBy.some((u) => u.id === item.id)) existing.usedBy.push({ id: item.id, name: item.name });
      } else {
        map.set(key, { key, name, condition, notes, required, usedBy: [{ id: item.id, name: item.name }], hasVariant: false });
      }
    }
  }
  const documents = [...map.values()];
  const counts = new Map<string, number>();
  for (const d of documents) counts.set(d.name, (counts.get(d.name) ?? 0) + 1);
  for (const d of documents) d.hasVariant = (counts.get(d.name) ?? 0) > 1;
  documents.sort((a, b) => b.usedBy.length - a.usedBy.length || a.name.localeCompare(b.name, 'zh-Hant'));
  return { documents, incomplete };
}
