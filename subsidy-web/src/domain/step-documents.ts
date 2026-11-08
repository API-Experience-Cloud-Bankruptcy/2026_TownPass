// 完成對應與協助頁「相關文件」分開：只有該步驟能確認備妥的文件才列入。
import reviewed from '../content/step-document-completion.json';
import { documentKey, effectiveDocuments, mergeDocuments } from './documents';
import { text } from './match';
import { sourceFingerprint } from './plain-language';
import { buildRoute } from './route';
import type { Answers, Subsidy } from './types';

interface CompletionRule {
  sourceFingerprint: string;
  reviewNote: string;
  steps: { step: string; documents: { index: number; name: string }[] }[];
}
export const stepDocumentRules: Record<string, CompletionRule> = reviewed;

/** 回傳精確的文件 key；不將同名異要求、待確認地區或其他地區文件一併完成。 */
export function completedStepDocumentKeys(item: Subsidy, index: number, answers: Answers = {}): string[] {
  const rule = stepDocumentRules[item.id];
  const entry = rule?.steps[index];
  if (!Number.isInteger(index) || !entry || entry.step !== buildRoute(item).steps[index]
    || rule.sourceFingerprint !== sourceFingerprint(item)) return [];
  const documents = effectiveDocuments(item);
  const applicable = new Set(mergeDocuments([item], answers).documents.map(doc => doc.key));
  return entry.documents.flatMap(reference => {
    const doc = documents[reference.index];
    if (!doc || doc.name !== reference.name) return [];
    const name = text(doc.name);
    const condition = text(doc.condition) === name ? '' : text(doc.condition);
    const key = documentKey(name, condition, text(doc.notes), typeof doc.required === 'boolean' ? doc.required : null,
      doc.regions, doc.region_basis, doc.region_evidence);
    return applicable.has(key) ? [key] : [];
  });
}
