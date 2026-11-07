import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { buildChecklist } from '../checklist';
import { createChecklistPdf, wrapChecklistText } from '../checklist-pdf';
import type { PlanInput } from '../export';
import { makeSubsidy } from './fixtures';

// 檢查實際 PDF 的文字繪製指令與 ToUnicode，不把輸入另存 metadata 假裝文字可讀。
function extractPdfText(pdf: PDFDocument): string {
  const streams: string[] = [];
  for (const [, value] of pdf.context.enumerateIndirectObjects()) {
    if (value instanceof PDFRawStream) {
      try { streams.push(new TextDecoder().decode(decodePDFRawStream(value).decode())); } catch { /* 字型二進位不作為文字 */ }
    }
  }
  const unicode = new Map<string, string>();
  for (const stream of streams.filter(s => s.includes('beginbfchar'))) {
    for (const match of stream.matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi)) {
      let value = '';
      for (let i = 0; i < match[2]!.length; i += 4) value += String.fromCharCode(parseInt(match[2]!.slice(i, i + 4), 16));
      unicode.set(match[1]!.toUpperCase(), value);
    }
  }
  let output = '';
  for (const stream of streams.filter(s => s.includes(' Tj'))) {
    for (const match of stream.matchAll(/<([\da-f]+)>\s*Tj/gi)) {
      for (let i = 0; i < match[1]!.length; i += 4) output += unicode.get(match[1]!.slice(i, i + 4).toUpperCase()) ?? '';
      output += '\n';
    }
  }
  return output;
}

const base = (): PlanInput => ({ meta: { catalogVersion: 'synthetic-pdf-v1', sourceLabel: '合成資料，非真實福利規定', generatedAt: new Date('2026-11-07T12:00:00+08:00') }, target: 'other', items: [makeSubsidy({ name: '合成範例：生活支援' })], conditions: [], results: new Map(), docChecks: {}, stepDone: {} });
afterEach(() => vi.unstubAllGlobals());

async function useLocalFont() {
  // 動態載入 node 模組，讓正式 app 的 TypeScript 設定不依賴 @types/node。
  const fs = await import('node:' + 'fs/promises');
  const bytes = await fs.readFile(new URL('../../assets/fonts/NotoSansTC-Regular.ttf', import.meta.url));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
}

describe('真正 A4 PDF', () => {
  it('字型、連結、頁碼、多頁與長文長網址皆保留，沒有填答洩漏', async () => {
    await useLocalFont();
    const input = base();
    const long = `${'完整資格長段甲乙丙丁；'.repeat(240)}資格末尾保留`;
    const url = `https://example.gov.tw/${'very-long-path-'.repeat(45)}?q=paper`;
    input.items[0]!.eligibility.raw_summary = long;
    input.items[0]!.application.urls.program = url;
    input.items[0]!.source_meta.sources = [{ url, role: 'program', type: 'official', checked_date: '2026-11-07' }];
    input.results.set(input.items[0]!.id, { id: input.items[0]!.id, fit: 'possible', reasons: ['私人年齡 42 歲'], warnings: [], blocked_by: [], personal: [{ list: 'reasons', text: '私人年齡 42 歲', field: 'age', neutral: '年齡待確認' }] });
    const bytes = await createChecklistPdf(input);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(3);
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 1);
      expect(page.getHeight()).toBeCloseTo(841.89, 1);
    }
    const actual = extractPdfText(pdf);
    // 逐一比對共用結構中所有文字，包含每項資格、文件、網址及尾端。
    const checklist = buildChecklist(input);
    const content = actual.split('\n').filter(line => !['福利行動檢核表', '申辦準備摘要，非送件或核准證明。'].includes(line) && !/^\d+ \/ \d+$/.test(line) && !/^資源 \d+（續）$/.test(line)).join('');
    for (const expected of [checklist.subtitle, checklist.privacyNotice, ...checklist.metaLines, ...checklist.sections.flatMap(s => [s.title, ...s.blocks.map(b => b.text)])]) expect(content).toContain(expected.replace(/\r?\n/g, ''));
    expect(actual).not.toContain('42 歲'); expect(actual).toContain('年齡待確認');
    expect(actual).toContain(`${pdf.getPageCount()} / ${pdf.getPageCount()}`);
    const objects = pdf.context.enumerateIndirectObjects().map(([, o]) => o.toString()).join('\n');
    expect(objects).toContain('/FontFile2'); expect(objects).toContain('/ToUnicode'); expect(objects).toContain('/Subtype /Link'); expect(objects).toContain(url);
    // 驗證斷行寬度（含長網址），避免只驗證頁數卻超出紙張。
    const fontPdf = await PDFDocument.create();
    const { default: fontkit } = await import('@pdf-lib/fontkit');
    fontPdf.registerFontkit(fontkit);
    const fontResponse = await fetch('test-font');
    const font = await fontPdf.embedFont(await fontResponse.arrayBuffer());
    for (const line of wrapChecklistText(`${long}\n${url}`, font, 11, 490)) expect(font.widthOfTextAtSize(line, 11)).toBeLessThanOrEqual(490);
  }, 30000);

  it('產出可視檢查的合成範例，保留準備進度', async () => {
    await useLocalFont();
    const input = base();
    input.items.push(makeSubsidy({ id: 'T-2', name: '合成範例：就學支援', eligibility: { raw_summary: '範例資格：請就讀學校確認身分及文件。此為合成資料，不代表真實補助。' }, application: { required_documents: [{ name: '在學證明', required: true, condition: '依就讀狀況準備', notes: '向學校確認版本與效期' }] } }));
    input.docChecks[JSON.stringify(['身分證', '', '', true])] = true;
    input.stepDone['T-0001'] = [0];
    const bytes = await createChecklistPdf(input);
    const pdf = await PDFDocument.load(bytes);
    expect(extractPdfText(pdf)).toContain('已準備：身分證');
    expect(extractPdfText(pdf)).toContain('已準備：1. 準備文件');
    const process = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process;
    if (process?.env?.CHECKLIST_PDF_EXAMPLE === '1') {
      const fs = await import('node:' + 'fs/promises');
      const folder = new URL('../../../../output/pdf/', import.meta.url);
      await fs.mkdir(folder, { recursive: true });
      await fs.writeFile(new URL('福利行動檢核表-範例.pdf', folder), bytes);
    }
  }, 30000);
});
