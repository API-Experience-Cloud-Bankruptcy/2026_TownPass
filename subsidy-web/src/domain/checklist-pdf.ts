import { PDFDocument, PDFName, PDFString, PageSizes, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fontUrl from '../assets/fonts/NotoSansTC-Regular.ttf?url';
import { buildChecklist, type ChecklistBlock } from './checklist';
import type { PlanInput } from './export';

// 本站靜態資產，不透過 CDN 或第三方服務。失敗可重試，避免快取 rejected Promise。
let fontBytesPromise: Promise<ArrayBuffer> | undefined;
function loadFont(): Promise<ArrayBuffer> {
  if (!fontBytesPromise) fontBytesPromise = fetch(fontUrl).then(response => {
    if (!response.ok) throw new Error('檢核表字型載入失敗，請稍後重試。');
    return response.arrayBuffer();
  }).catch(error => { fontBytesPromise = undefined; throw error; });
  return fontBytesPromise;
}

const MARGIN = 42;
const BOTTOM = 50;
const BODY_SIZE = 11;
const LINE_HEIGHT = 16;

/** 逐 Unicode 字元斷行，長網址及無空格原文同樣可分頁；不裁切內容。 */
export function wrapChecklistText(value: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  const widths = new Map<string, number>();
  for (const paragraph of value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    let line = '';
    let used = 0;
    for (const char of paragraph) {
      let charWidth = widths.get(char);
      if (charWidth === undefined) { charWidth = font.widthOfTextAtSize(char, size); widths.set(char, charWidth); }
      if (line && used + charWidth > width - 2) { lines.push(line); line = ''; used = 0; }
      line += char;
      used += charWidth;
    }
    lines.push(line);
  }
  return lines;
}

export async function createChecklistPdf(input: PlanInput): Promise<Uint8Array> {
  const checklist = buildChecklist(input);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // fontkit 的 CJK subset 在 Poppler 實測有缺字，完整嵌入以確保列印與跨閱讀器正確。
  const font = await pdf.embedFont(await loadFont(), { subset: false });
  const chars = new Set(font.getCharacterSet());
  // 字型不支援的罕用字以碼位明示，避免靜默輸出空白方塊。
  const printable = (value: string) => Array.from(value).map(c => c === '\n' || c === '\r' || c === '\t' || chars.has(c.codePointAt(0)!) ? c : `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`).join('');
  const [width, height] = PageSizes.A4;
  const contentWidth = width - MARGIN * 2;
  let page: PDFPage;
  let y = 0;
  let currentSection = '';
  const newPage = () => {
    page = pdf.addPage(PageSizes.A4);
    y = height - 72;
    page.drawText(checklist.title, { x: MARGIN, y: height - 35, size: 10.5, font, color: rgb(.25, .25, .25) });
    page.drawLine({ start: { x: MARGIN, y: height - 44 }, end: { x: width - MARGIN, y: height - 44 }, color: rgb(.7, .7, .7), thickness: .5 });
    if (currentSection) {
      const continued = wrapChecklistText(printable(`${currentSection}（續）`), font, 10.5, contentWidth);
      for (const line of continued) { page.drawText(line, { x: MARGIN, y, size: 10.5, font }); y -= 15; }
      y -= 8;
    }
  };
  const ensure = (space: number) => { if (y - space < BOTTOM) newPage(); };
  const draw = (value: string, options: { size?: number; indent?: number; url?: string; heading?: boolean; check?: boolean; checked?: boolean } = {}) => {
    const size = options.size ?? BODY_SIZE;
    const indent = options.indent ?? 0;
    const leading = size === BODY_SIZE ? LINE_HEIGHT : size * 1.4;
    const lines = wrapChecklistText(printable(value), font, size, contentWidth - indent);
    if (options.heading) ensure(leading * Math.min(3, lines.length) + LINE_HEIGHT + 8);
    let first = true;
    for (const line of lines) {
      ensure(leading);
      if (options.check && first) {
        page.drawRectangle({ x: MARGIN, y: y - 1, width: 10, height: 10, borderColor: rgb(0, 0, 0), borderWidth: .7 });
        if (options.checked) {
          page.drawLine({ start: { x: MARGIN + 2, y: y + 4 }, end: { x: MARGIN + 4, y: y + 1 }, thickness: 1 });
          page.drawLine({ start: { x: MARGIN + 4, y: y + 1 }, end: { x: MARGIN + 9, y: y + 8 }, thickness: 1 });
        }
      }
      page.drawText(line, { x: MARGIN + indent, y, font, size, color: rgb(0, 0, 0) });
      if (options.url && line) {
        const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [MARGIN + indent, y - 3, MARGIN + indent + font.widthOfTextAtSize(line, size), y + size], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(options.url) } });
        page.node.addAnnot(pdf.context.register(annotation));
      }
      first = false;
      y -= leading;
    }
    y -= options.heading ? 4 : 2;
  };
  newPage();
  draw(checklist.title, { size: 22, heading: true });
  draw(checklist.subtitle);
  for (const line of checklist.metaLines) draw(line, { size: 10.5 });
  draw(checklist.privacyNotice);
  for (const condition of checklist.conditions) draw(condition);
  draw('使用方式：先核對文件，再依每項資源的資格、期限與窗口準備。請保留本表，向承辦單位詢問並記錄下一步。');
  for (const section of checklist.sections) {
    // 每個資源從新頁開始，便於家人分開交接；長資源仍持續分頁。
    currentSection = '';
    if (section.id.startsWith('resource:')) newPage();
    else ensure(70);
    draw(section.title, { size: 16, heading: true });
    currentSection = section.id.startsWith('resource:') ? `資源 ${checklist.sections.indexOf(section)}` : section.title;
    for (const block of section.blocks) renderBlock(block);
  }
  function renderBlock(block: ChecklistBlock) {
    if (block.kind === 'heading') { y -= 4; draw(block.text, { size: 13, heading: true }); }
    else if (block.kind === 'check') draw(`${block.checked ? '已準備：' : ''}${block.text}`, { check: true, checked: block.checked, indent: 18 });
    else if (block.kind === 'link') draw(block.text, { size: 10.5, url: block.url });
    else if (block.kind === 'notes') {
      ensure(74);
      draw(block.text, { size: 10.5 });
      for (let i = 0; i < 2; i++) {
        ensure(23);
        page.drawLine({ start: { x: MARGIN, y }, end: { x: width - MARGIN, y }, thickness: .5, color: rgb(.65, .65, .65) });
        y -= 23;
      }
    } else draw(block.text);
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MARGIN, y: 38 }, end: { x: width - MARGIN, y: 38 }, thickness: .5, color: rgb(.7, .7, .7) });
    p.drawText(`申辦準備摘要，非送件或核准證明。`, { x: MARGIN, y: 23, size: 10.5, font });
    const counter = `${i + 1} / ${pages.length}`;
    p.drawText(counter, { x: width - MARGIN - font.widthOfTextAtSize(counter, 10.5), y: 23, size: 10.5, font });
  });
  pdf.setTitle(checklist.title);
  pdf.setSubject('申辦準備檢核表；不代表送件或核准');
  pdf.setCreator('福利通');
  pdf.setCreationDate(input.meta.generatedAt);
  // 不把輸入、答案或完整結構寫進 metadata。
  pdf.catalog.set(PDFName.of('Lang'), PDFString.of('zh-Hant-TW'));
  return pdf.save();
}
