import { formAvailability, formPdfUrl } from './form-fields';
import { safeUrl } from './url';
import type { Subsidy } from './types';

export interface FormResource {
  id: string;
  label: string;
  url: string;
  sourceUrl: string | null;
  formId: string | null;
  kind: 'file' | 'online' | 'source';
}
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown) => typeof v === 'string' ? v.trim() : '';

/** 保留不能自動填寫的附件；URL 去重，但不把說明頁稱作原檔。 */
export function formResources(item: Subsidy): FormResource[] {
  const app = item.application;
  const main = obj(app.form_fields);
  const entries = [main, ...(Array.isArray(main.attachments) ? main.attachments.map(obj) : [])];
  const available = formAvailability(item);
  const forms = available.kind === 'fillable' ? available.forms : [];
  const resources: FormResource[] = [];
  const seen = new Set<string>();
  function add(url: string, label: string, sourceUrl: string | null, formId: string | null, kind: FormResource['kind']) {
    if (seen.has(url) || (sourceUrl && seen.has(sourceUrl))) return;
    seen.add(url);
    if (sourceUrl) seen.add(sourceUrl);
    resources.push({ id: `file-${resources.length}`, label, url, sourceUrl, formId, kind });
  }
  for (const [index, entry] of entries.entries()) {
    const localFile = str(entry.local_file);
    const localUrl = formPdfUrl(localFile);
    const sourceUrl = safeUrl(entry.source_url);
    const label = str(entry.label) || (index === 0 ? '申請表或附件' : `附件 ${index}`);
    const formId = forms.find(f => f.id === localFile)?.id ?? null;
    const kind = entry.status === 'online_system' ? 'online'
      : localUrl || ['analyzed', 'office_file_only', 'scanned_image_pdf', 'text_unreadable'].includes(str(entry.status)) ? 'file' : 'source';
    if (localUrl || sourceUrl) add(localUrl ?? sourceUrl!, label, sourceUrl, formId, kind);
    if (Array.isArray(entry.office_files)) {
      entry.office_files.forEach((value, i) => {
        const url = safeUrl(value);
        if (url) add(url, `${label}（下載檔案 ${i + 1}）`, url, null, 'file');
      });
    }
  }
  const formUrl = safeUrl(app.urls?.form);
  if (formUrl) add(formUrl, '表單下載頁', formUrl, null, 'source');
  return resources;
}

const normalized = (s: string) => s.normalize('NFKC').replace(/(?:PDF|DOCX?|ODT)(?:檔)?/gi, '').replace(/[\s\p{P}\p{S}]/gu, '');
/** 只接受唯一的明確名稱配對。合併文件、泛稱及多份同類表單不猜測。 */
export function documentResource(name: string, resources: FormResource[]): FormResource | null {
  const key = normalized(name);
  if (key.length < 3 || /[、／/]|及|與|或/.test(name)) return null;
  const files = resources.filter(r => r.kind === 'file');
  const exact = files.filter(r => normalized(r.label) === key);
  if (exact.length) return exact.length === 1 ? exact[0]! : null;
  if (!/(申請表|申請書|切結書|同意書|委託書|授權書)$/.test(key)) return null;
  const matches = files.filter(r => normalized(r.label).includes(key));
  return matches.length === 1 ? matches[0]! : null;
}
