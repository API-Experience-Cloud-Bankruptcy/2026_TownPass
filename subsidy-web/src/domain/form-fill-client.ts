// 把「取得空白表單 → 填寫 → 包成可下載／分享的檔案」串起來，供元件使用。
// 字型與 PDF 都來自本站（不透過 CDN）；失敗可重試，不快取 rejected Promise。

import fontUrl from '../assets/fonts/NotoSansTC-Regular.ttf?url';
import type { FetchLike } from './catalog';
import { fetchFormPdf, type FillableForm } from './form-fields';
import { fillForm, manualSummary, type FillReport } from './form-fill';
import type { ConfirmedProfile } from './form-profile';
import type { Target } from './types';

let fontPromise: Promise<ArrayBuffer> | undefined;
export function loadFormFont(fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<ArrayBuffer> {
  if (!fontPromise) {
    fontPromise = fetchImpl(fontUrl)
      .then((r) => { if (!r.ok) throw new Error('中文字型載入失敗，請稍後重試。'); return r.arrayBuffer(); })
      .catch((e) => { fontPromise = undefined; throw e; });
  }
  return fontPromise;
}

/** 分享橋接要求：不以 . 開頭、無前後空白、≤120 字元、以 .pdf 結尾。 */
export function safeFilename(label: string, suffix = '已填'): string {
  const base = label.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\s.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${base || '申請表'}-${suffix}.pdf`;
}

export interface FilledForm {
  file: File;
  report: FillReport;
  summary: ReturnType<typeof manualSummary>;
}

export async function createFilledForm(
  form: FillableForm,
  profile: ConfirmedProfile,
  target: Target | null,
  options: { base?: string; fetchImpl?: FetchLike; loadFont?: () => Promise<ArrayBuffer | Uint8Array> } = {},
): Promise<FilledForm> {
  const [pdf, font] = await Promise.all([
    fetchFormPdf(form.entry, { base: options.base, fetchImpl: options.fetchImpl }),
    (options.loadFont ?? loadFormFont)(),
  ]);
  const report = await fillForm(pdf, font, form.entry, profile, target);
  const file = new File([new Uint8Array(report.bytes)], safeFilename(form.label), { type: 'application/pdf' });
  return { file, report, summary: manualSummary(form.entry, report) };
}
