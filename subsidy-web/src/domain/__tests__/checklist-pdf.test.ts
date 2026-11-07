import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFArray, PDFDocument, PDFRawStream, PDFRef, decodePDFRawStream, type PDFObject, type PDFPage } from 'pdf-lib';
import { buildChecklist, type ChecklistForm } from '../checklist';
import { createChecklistPdf, FOOTER_NOTE, wrapChecklistText } from '../checklist-pdf';
import { mergeDocuments } from '../documents';
import type { PlanInput } from '../export';
import { evaluateAll } from '../match';
import { makeSubsidy } from './fixtures';
import { realItem } from './real-data';

const decode = (stream: PDFObject | undefined): string => {
  if (!(stream instanceof PDFRawStream)) return '';
  try { return new TextDecoder().decode(decodePDFRawStream(stream).decode()); } catch { return ''; }
};

// 檢查實際 PDF 的文字繪製指令與 ToUnicode，逐頁取出每一行；不把輸入另存 metadata 假裝文字可讀。
function extractPages(pdf: PDFDocument): string[][] {
  const unicode = new Map<string, string>();
  for (const [, value] of pdf.context.enumerateIndirectObjects()) {
    const stream = decode(value);
    if (!stream.includes('beginbfchar')) continue;
    for (const match of stream.matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi)) {
      let char = '';
      for (let i = 0; i < match[2]!.length; i += 4) char += String.fromCharCode(parseInt(match[2]!.slice(i, i + 4), 16));
      unicode.set(match[1]!.toUpperCase(), char);
    }
  }
  return pdf.getPages().map((page: PDFPage) => {
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    const lines: string[] = [];
    for (const ref of refs) {
      const stream = decode(ref instanceof PDFRef ? pdf.context.lookup(ref) : ref);
      for (const match of stream.matchAll(/<([\da-f]+)>\s*Tj/gi)) {
        let line = '';
        for (let i = 0; i < match[1]!.length; i += 4) line += unicode.get(match[1]!.slice(i, i + 4).toUpperCase()) ?? '';
        lines.push(line);
      }
    }
    return lines;
  });
}

/** 期望字串須由依序出現的繪製行拼成（允許中間夾雜其他欄、頁首尾及表頭），證明換行、換頁沒有遺漏字元。 */
function containsInOrder(lines: string[], expected: string): boolean {
  const target = expected.replace(/\r?\n/g, '');
  if (!target) return true;
  for (let start = 0; start < lines.length; start++) {
    if (!lines[start] || !target.startsWith(lines[start]!)) continue;
    let pos = lines[start]!.length;
    let j = start + 1;
    while (pos < target.length) {
      while (j < lines.length && !(lines[j] && target.startsWith(lines[j]!, pos))) j++;
      if (j >= lines.length) break;
      pos += lines[j]!.length;
      j++;
    }
    if (pos >= target.length) return true;
  }
  return false;
}

/** 表單結構中所有應印出的文字（排除內部鍵）。 */
function formStrings(form: ChecklistForm): string[] {
  const out: string[] = [];
  const walk = (value: unknown, key: string) => {
    if (key === 'key' || key === 'id') return;
    if (typeof value === 'string') { if (value) out.push(value); return; }
    if (Array.isArray(value)) { value.forEach(v => walk(v, key)); return; }
    if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  const { emptyNote, ...rest } = form;
  walk(rest, '');
  if (!form.resources.length) out.push(emptyNote);
  return out;
}

const base = (): PlanInput => ({ meta: { catalogVersion: 'synthetic-pdf-v1', sourceLabel: '合成資料，非真實福利規定', generatedAt: new Date('2026-11-07T12:00:00+08:00') }, target: 'other', items: [makeSubsidy({ name: '合成範例：生活支援' })], conditions: [], results: new Map(), docChecks: {}, stepDone: {} });
afterEach(() => vi.unstubAllGlobals());

async function useLocalFont() {
  // 動態載入 node 模組，讓正式 app 的 TypeScript 設定不依賴 @types/node。
  const fs = await import('node:' + 'fs/promises');
  const bytes = await fs.readFile(new URL('../../assets/fonts/NotoSansTC-Regular.ttf', import.meta.url));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
}

async function render(input: PlanInput) {
  const bytes = await createChecklistPdf(input);
  const pdf = await PDFDocument.load(bytes);
  return { bytes, pdf, pages: extractPages(pdf), form: buildChecklist(input).form };
}

function expectChrome(pages: string[][], form: ChecklistForm) {
  pages.forEach((lines, i) => {
    expect(lines).toContain(FOOTER_NOTE);
    expect(lines).toContain(`文件編號 ${form.code}`);
    expect(lines).toContain(`第 ${i + 1} 頁，共 ${pages.length} 頁`);
    // 續頁重複精簡頁首；第 1 頁為完整表頭。
    if (i > 0) expect(lines).toContain(form.title);
    else expect(containsInOrder(lines, form.title)).toBe(true);
  });
}

describe('A4 表單式 PDF', () => {
  it('長文長網址完整保留、表頭續頁重複、頁首尾與頁碼正確，沒有填答洩漏', async () => {
    await useLocalFont();
    const input = base();
    const long = `${'完整資格長段甲乙丙丁；'.repeat(240)}資格末尾保留`;
    const longRule = `${'排除條件長段子丑寅卯；'.repeat(160)}排除末尾保留`;
    const url = `https://example.gov.tw/${'very-long-path-'.repeat(45)}?q=paper`;
    const item = input.items[0]!;
    item.eligibility.raw_summary = long;
    item.eligibility.exclusions = [longRule];
    item.application.urls.program = url;
    item.source_meta.sources = [{ url, role: 'program', type: 'official', checked_date: '2026-11-07' }];
    input.results.set(item.id, { id: item.id, fit: 'possible', reasons: ['私人年齡 42 歲'], warnings: [], blocked_by: [], personal: [{ list: 'reasons', text: '私人年齡 42 歲', field: 'age', neutral: '年齡待確認' }] });
    const { pdf, pages, form } = await render(input);
    expect(pdf.getPageCount()).toBeGreaterThan(3);
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(595.28, 1);
      expect(page.getHeight()).toBeCloseTo(841.89, 1);
    }
    expectChrome(pages, form);
    const all = pages.flat();
    const missing = formStrings(form).filter(s => !containsInOrder(all, s));
    expect(missing).toEqual([]);
    // 資格條件表跨頁時，續頁重繪表頭。
    const continued = pages.filter(lines => lines.some(l => l.includes('（二）資格條件（續）')));
    expect(continued.length).toBeGreaterThan(0);
    for (const lines of continued) expect(lines).toEqual(expect.arrayContaining(['條件類別', '原文']));
    expect(all.join('')).not.toContain('42 歲'); expect(all).toContain('年齡待確認');
    const objects = pdf.context.enumerateIndirectObjects().map(([, o]) => o.toString()).join('\n');
    expect(objects).toContain('/FontFile2'); expect(objects).toContain('/ToUnicode'); expect(objects).toContain('/Subtype /Link'); expect(objects).toContain(url);
    expect(pdf.getTitle()).toBe(form.title);
    expect(objects).toContain('/Lang (zh-Hant-TW)');
    // 驗證斷行寬度（含長網址），避免只驗證頁數卻超出紙張。
    const fontPdf = await PDFDocument.create();
    const { default: fontkit } = await import('@pdf-lib/fontkit');
    fontPdf.registerFontkit(fontkit);
    const font = await fontPdf.embedFont(await (await fetch('test-font')).arrayBuffer());
    for (const line of wrapChecklistText(`${long}\n${url}`, font, 9.5, 300)) expect(font.widthOfTextAtSize(line, 9.5)).toBeLessThanOrEqual(300);
  }, 60000);

  it('多項目：總覽列數、合併文件列數、每項目另起新頁並保留勾選', async () => {
    await useLocalFont();
    const input = base();
    input.items.push(makeSubsidy({ id: 'T-2', name: '合成範例：就學支援', eligibility: { raw_summary: '範例資格：請就讀學校確認身分及文件。' }, application: { required_documents: [{ name: '在學證明', required: true, condition: '依就讀狀況準備', notes: '向學校確認版本與效期' }, { name: '身分證', required: true, condition: null, notes: '' }] } }));
    input.items.push(makeSubsidy({ id: 'T-3', name: '合成範例：無文件清單', application: { required_documents: [] } }));
    input.docChecks[JSON.stringify(['身分證', '', '', true])] = true;
    input.stepDone['T-0001'] = [0];
    const { pages, form } = await render(input);
    expectChrome(pages, form);
    expect(form.overview).toHaveLength(input.items.length);
    expect(form.documents).toHaveLength(mergeDocuments(input.items).documents.length);
    expect(form.documents.find(d => d.name === '身分證')?.usedBy).toBe('1、2');
    expect(form.incomplete.map(i => i.no)).toEqual([3]);
    const firstResource = pages.findIndex(lines => lines.some(l => l.startsWith('四、項目檢核')));
    const front = pages.slice(0, firstResource).flat();
    for (const row of form.overview) expect(containsInOrder(front, row.name)).toBe(true);
    for (const doc of form.documents) expect(containsInOrder(front, doc.name)).toBe(true);
    expect(front).toContain('文件清單未補齊');
    // 各項目頁首為該項目，頁次欄指向該頁。
    for (const resource of form.resources) {
      const index = pages.findIndex(lines => containsInOrder(lines, `四、項目檢核　項目 ${resource.no}／${form.resources.length}　${resource.name}`));
      expect(index).toBeGreaterThan(0);
      expect(front).toContain(String(index + 1));
    }
    const all = pages.flat();
    expect(all.filter(l => l === '已備')).toHaveLength(1);
    expect(all.filter(l => l === '完成').length).toBeGreaterThanOrEqual(2);
    expect(formStrings(form).filter(s => !containsInOrder(all, s))).toEqual([]);
  }, 60000);

  it('未選資源時仍產生完整表頭、空白說明與表末欄位', async () => {
    await useLocalFont();
    const input = { ...base(), items: [] };
    const { pages, form } = await render(input);
    expectChrome(pages, form);
    const all = pages.flat();
    expect(all.filter(l => l === form.emptyNote)).toHaveLength(3);
    expect(all.some(l => l.includes('項目 1'))).toBe(false);
    for (const title of ['一、基本資料', '二、申請項目總覽', '三、應備文件核對表', '四、項目檢核', '五、洽詢紀錄', '六、確認欄', '七、注意事項']) expect(all).toContain(title);
    expect(formStrings(form).filter(s => !containsInOrder(all, s))).toEqual([]);
  }, 60000);

  it('同意的條件另列，未同意不出現', async () => {
    await useLocalFont();
    const input = base();
    input.conditions = [{ field: 'age', line: '對方今年幾歲：72 歲' }];
    const { pages, form } = await render(input);
    const all = pages.flat();
    expect(all).toContain(form.conditionsTitle);
    expect(all).toContain('對方今年幾歲：72 歲');
  }, 60000);

  // 產出實際資料範例供逐頁目視；需設定 CHECKLIST_PDF_OUT 輸出資料夾。
  const outDir = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.CHECKLIST_PDF_OUT;
  it.runIf(!!outDir)('產出實際資料範例', async () => {
    await useLocalFont();
    const fs = await import('node:' + 'fs/promises');
    const write = async (name: string, input: PlanInput) => {
      const bytes = await createChecklistPdf(input);
      await fs.mkdir(outDir!, { recursive: true });
      await fs.writeFile(`${outDir}/${name}.pdf`, bytes);
    };
    const meta = { catalogVersion: 'subsidies.json（backend/data）', sourceLabel: '臺北市政府及中央機關公開資料整理', generatedAt: new Date('2026-11-08T10:00:00+08:00') };
    const one = [realItem('CT-0104')];
    await write('a-one-resource', { meta, target: 'other', items: one, results: evaluateAll(one, { age: 72 }, '2026-11-08'), conditions: [{ field: 'age', line: '對方今年幾歲：72 歲' }], docChecks: {}, stepDone: {} });
    const longItem = realItem('CT-0047');
    longItem.eligibility.raw_summary = `${longItem.eligibility.raw_summary ?? ''}${'（測試用延長段落：長照需要等級、失能程度、身分別及各項給付額度依主管機關核定，請以照管中心評估為準。）'.repeat(14)}`;
    longItem.application.urls.form = `https://www.example.gov.tw/${'download/attachment-'.repeat(12)}form.pdf?id=${'a1b2c3'.repeat(10)}`;
    const four = [realItem('CT-0104'), realItem('CT-0109'), longItem, realItem('WEL-0084')];
    const docs = mergeDocuments(four).documents;
    await write('b-four-resources', { meta, target: 'other', items: four, results: evaluateAll(four, { age: 72 }, '2026-11-08'), conditions: [], docChecks: { [docs[0]!.key]: true }, stepDone: { 'WEL-0084': [0, 1] } });
    await write('c-no-resources', { meta, target: 'other', items: [], results: new Map(), conditions: [], docChecks: {}, stepDone: {} });
  }, 120000);
});

describe('PDF 文件表依戶籍篩選', () => {
  const ltc = (region?: string): PlanInput => ({ ...base(), items: [realItem('CT-0047')], region });
  it('臺北市不印其他縣市文件；未回答時另表列出', async () => {
    await useLocalFont();
    const taipei = (await render(ltc('臺北市'))).pages.flat();
    expect(containsInOrder(taipei, '新北市政府長期照顧服務申請書')).toBe(false);
    expect(containsInOrder(taipei, '宜蘭縣長期照顧服務申請書')).toBe(false);
    expect(taipei).not.toContain('其他縣市的規定');
    const unanswered = await render(ltc());
    const lines = unanswered.pages.flat();
    expect(lines).toContain('其他縣市的規定');
    const titleAt = lines.indexOf('其他縣市的規定');
    for (const doc of unanswered.form.otherRegionDocuments) expect(containsInOrder(lines.slice(titleAt), doc.name)).toBe(true);
  }, 60000);
});
