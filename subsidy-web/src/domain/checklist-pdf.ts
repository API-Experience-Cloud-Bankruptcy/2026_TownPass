import {
  PDFDocument, PDFName, PDFString, PageSizes, TextRenderingMode, popGraphicsState, pushGraphicsState, rgb,
  setLineWidth, setStrokingColor, setTextRenderingMode, type PDFFont, type PDFPage, type RGB,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fontUrl from '../assets/fonts/NotoSansTC-Regular.ttf?url';
import { buildChecklist, type ChecklistForm, type FormField } from './checklist';
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

// 行首不放收尾標點、行尾不留開頭括號（避頭尾）；只搬移一個字，不改內容。
const NO_LINE_START = new Set(Array.from('，。、；：！？）」』】〉》〕,.;:!?)]}%％'));
const NO_LINE_END = new Set(Array.from('（「『【〈《〔([{'));

/** 逐 Unicode 字元斷行，長網址及無空格原文同樣可分頁；不裁切內容。 */
export function wrapChecklistText(value: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  const widths = new Map<string, number>();
  const measure = (char: string) => {
    let charWidth = widths.get(char);
    if (charWidth === undefined) { charWidth = font.widthOfTextAtSize(char, size); widths.set(char, charWidth); }
    return charWidth;
  };
  for (const paragraph of value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
    let line: string[] = [];
    let used = 0;
    for (const char of paragraph) {
      const charWidth = measure(char);
      if (line.length && used + charWidth > width - 2) {
        let carry: string[] = [];
        const last = line[line.length - 1]!;
        if (line.length > 1 && (NO_LINE_START.has(char) || NO_LINE_END.has(last))) carry = [line.pop()!];
        lines.push(line.join(''));
        line = carry;
        used = carry.reduce((sum, c) => sum + measure(c), 0);
      }
      line.push(char);
      used += charWidth;
    }
    lines.push(line.join(''));
  }
  return lines;
}

/** 橫排繁中與拉丁字不需字形替換；列出字型提供及 fontkit 預設啟用的全部功能並關閉。 */
const PLAIN_GLYPHS = Object.fromEntries(['aalt', 'calt', 'ccmp', 'clig', 'curs', 'dlig', 'dnom', 'fwid', 'halt', 'hist', 'hwid', 'kern', 'liga', 'locl', 'mark', 'mkmk', 'numr', 'palt', 'pwid', 'rclt', 'rlig', 'ruby', 'rvrn', 'vert', 'vhal', 'vkrn', 'vpal', 'vrt2'].map(f => [f, false]));

/** 頁尾短聲明；完整注意事項在表末。 */
export const FOOTER_NOTE = '非機關正式表單・非送件或核准證明';

// A4 版面：左右 1.8 cm、上下約 2 cm（頁尾位於下邊界內）。
const [PAGE_W, PAGE_H] = PageSizes.A4;
const MX = 51;
const CONTENT_W = PAGE_W - MX * 2;
const BODY_BOTTOM = 58;
const CONT_TOP = PAGE_H - 56;
const TITLE_SIZE = 18;
const SECTION_SIZE = 12.5;
const SUB_SIZE = 10.5;
const CELL_SIZE = 9.5;
const SMALL_SIZE = 8;
const LEAD = 13.4;
const PAD_X = 4.5;
const PAD_Y = 4;
const BOX = 8.5;
/** 表末三節（洽詢紀錄、確認欄、注意事項）約略高度，空間不足時整段移到新頁。 */
const CLOSING_HEIGHT = 600;
const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.34, 0.34, 0.34);
const RULE = rgb(0.3, 0.3, 0.3);
const LABEL_FILL = rgb(0.94, 0.94, 0.94);
const HEAD_FILL = rgb(0.87, 0.87, 0.87);
const BAR_FILL = rgb(0.8, 0.8, 0.8);
/** 唯一強調色：可點連結。 */
const LINK = rgb(0.1, 0.29, 0.47);

interface Cell {
  text?: string;
  url?: string;
  fill?: 'label' | 'head';
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  size?: number;
  color?: RGB;
  span?: number;
  /** 方框；勾選時於框右註記 label */
  check?: { checked: boolean; label: string };
  /** 版面完成後才知道的內容（頁次） */
  deferred?: () => string;
}
interface PlacedCell { cell: Cell; x: number; w: number; lines: string[] }
interface TableSpec { widths: number[]; header?: Cell[]; rows: Cell[][]; minRowHeight?: number; context: string }

const label = (text: string, extra: Partial<Cell> = {}): Cell => ({ text, fill: 'label', align: 'center', ...extra });
const head = (text: string, extra: Partial<Cell> = {}): Cell => ({ text, fill: 'head', bold: true, align: 'center', ...extra });

export async function createChecklistPdf(input: PlanInput): Promise<Uint8Array> {
  const checklist = buildChecklist(input);
  const form: ChecklistForm = checklist.form;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // fontkit 的 CJK subset 在 Poppler 實測有缺字，完整嵌入以確保列印與跨閱讀器正確。
  // 關閉 OpenType 替換：預設替換會把拉丁字母後的數字換成替代字形，其 ToUnicode 對應錯誤，複製與搜尋得到亂碼。
  const font = await pdf.embedFont(await loadFont(), { subset: false, features: PLAIN_GLYPHS });
  const chars = new Set(font.getCharacterSet());
  // 字型不支援的罕用字以碼位明示，避免靜默輸出空白方塊。
  const printable = (value: string) => Array.from(value).map(c => c === '\n' || c === '\r' || c === '\t' || chars.has(c.codePointAt(0)!) ? c : `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`).join('');
  const widthOf = (value: string, size: number) => font.widthOfTextAtSize(value, size);

  let page!: PDFPage;
  let y = 0;
  const deferredCells: { page: PDFPage; x: number; w: number; top: number; h: number; value: () => string }[] = [];

  /** 只嵌入 Regular 字重；以填色加描邊模擬粗體，避免另載字型。 */
  function drawString(target: PDFPage, value: string, x: number, baseline: number, size: number, options: { bold?: boolean; color?: RGB } = {}) {
    if (!value) return;
    const color = options.color ?? INK;
    if (options.bold) target.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.FillAndOutline), setLineWidth(size * 0.035), setStrokingColor(color));
    target.drawText(value, { x, y: baseline, size, font, color });
    if (options.bold) target.pushOperators(popGraphicsState());
  }

  function addLink(target: PDFPage, url: string, x: number, baseline: number, width: number, size: number) {
    const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, baseline - 3, x + width, baseline + size], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } });
    target.node.addAnnot(pdf.context.register(annotation));
  }

  /** 續頁：精簡頁首（表名與文件編號）。 */
  function newPage() {
    page = pdf.addPage(PageSizes.A4);
    drawString(page, form.title, MX, PAGE_H - 36, 9, { bold: true });
    const code = `文件編號 ${form.code}`;
    drawString(page, code, PAGE_W - MX - widthOf(code, SMALL_SIZE), PAGE_H - 36, SMALL_SIZE, { color: MUTED });
    page.drawLine({ start: { x: MX, y: PAGE_H - 42 }, end: { x: PAGE_W - MX, y: PAGE_H - 42 }, thickness: 0.6, color: RULE });
    y = CONT_TOP;
  }

  function continuation(context: string) {
    for (const line of wrapChecklistText(printable(`${context}（續）`), font, SMALL_SIZE + 1, CONTENT_W)) {
      drawString(page, line, MX, y - 9, SMALL_SIZE + 1, { color: MUTED });
      y -= 13;
    }
    y -= 3;
  }

  function placeRow(cells: Cell[], widths: number[]): { placed: PlacedCell[]; lineCount: number } {
    const placed: PlacedCell[] = [];
    let col = 0;
    let lineCount = 1;
    for (const cell of cells) {
      const span = cell.span ?? 1;
      const x = MX + widths.slice(0, col).reduce((a, b) => a + b, 0);
      const w = widths.slice(col, col + span).reduce((a, b) => a + b, 0);
      col += span;
      const lines = cell.text ? wrapChecklistText(printable(cell.text), font, cell.size ?? CELL_SIZE, w - PAD_X * 2) : [];
      lineCount = Math.max(lineCount, lines.length);
      placed.push({ cell, x, w, lines });
    }
    return { placed, lineCount };
  }

  const rowHeight = (lineCount: number, min = 0) => Math.max(min, lineCount * LEAD + PAD_Y * 2);

  /** 一列：底色、文字（垂直置中）、方框與內框線。 */
  function drawRow(placed: PlacedCell[], top: number, h: number, drawChecks: boolean) {
    for (const { cell, x, w } of placed) {
      if (cell.fill) page.drawRectangle({ x, y: top - h, width: w, height: h, color: cell.fill === 'head' ? HEAD_FILL : LABEL_FILL });
    }
    for (const { cell, x, w, lines } of placed) {
      const size = cell.size ?? CELL_SIZE;
      const blockTop = top - (h - lines.length * LEAD) / 2;
      lines.forEach((line, n) => {
        const lineWidth = widthOf(line, size);
        const lx = cell.align === 'center' ? x + (w - lineWidth) / 2 : cell.align === 'right' ? x + w - PAD_X - lineWidth : x + PAD_X;
        const baseline = blockTop - n * LEAD - LEAD + (LEAD - size) / 2 + 2;
        drawString(page, line, lx, baseline, size, { bold: cell.bold, color: cell.url ? LINK : cell.color });
        if (cell.url && line) addLink(page, cell.url, lx, baseline, lineWidth, size);
      });
      if (cell.check && drawChecks) {
        const note = cell.check.checked ? cell.check.label : '';
        const total = BOX + (note ? 3 + widthOf(note, SMALL_SIZE) : 0);
        const bx = x + (w - total) / 2;
        const by = top - h / 2 - BOX / 2;
        page.drawRectangle({ x: bx, y: by, width: BOX, height: BOX, borderColor: INK, borderWidth: 0.7 });
        if (cell.check.checked) {
          page.drawLine({ start: { x: bx + 1.6, y: by + 4.4 }, end: { x: bx + 3.6, y: by + 1.8 }, thickness: 1.1, color: INK });
          page.drawLine({ start: { x: bx + 3.6, y: by + 1.8 }, end: { x: bx + 7.4, y: by + 7.4 }, thickness: 1.1, color: INK });
          drawString(page, note, bx + BOX + 3, by + 1.2, SMALL_SIZE);
        }
      }
      if (cell.deferred) deferredCells.push({ page, x, w, top, h, value: cell.deferred });
      page.drawRectangle({ x, y: top - h, width: w, height: h, borderColor: RULE, borderWidth: 0.5 });
    }
  }

  /** 表格：依欄寬斷行，列高取最高格；換頁時重繪表頭，過高的列依行界分頁，不在行中截斷。 */
  function table(spec: TableSpec) {
    const header = spec.header ? placeRow(spec.header, spec.widths) : undefined;
    const headerH = header ? rowHeight(header.lineCount) : 0;
    const minSplit = PAD_Y * 2 + LEAD * 3;
    let segmentTop = y;
    const closeSegment = () => {
      if (segmentTop - y > 0.1) page.drawRectangle({ x: MX, y, width: CONTENT_W, height: segmentTop - y, borderColor: INK, borderWidth: 1 });
    };
    const startSegment = (continued: boolean) => {
      if (continued) { closeSegment(); newPage(); continuation(spec.context); }
      segmentTop = y;
      if (header) { drawRow(header.placed, y, headerH, true); y -= headerH; }
    };
    const first = spec.rows[0] ? placeRow(spec.rows[0], spec.widths) : undefined;
    const firstNeed = headerH + (first ? Math.min(rowHeight(first.lineCount, spec.minRowHeight), minSplit) : 0);
    if (y - firstNeed < BODY_BOTTOM) { newPage(); continuation(spec.context); }
    startSegment(false);
    for (const row of spec.rows) {
      let { placed, lineCount } = placeRow(row, spec.widths);
      let drawChecks = true;
      for (;;) {
        const h = rowHeight(lineCount, spec.minRowHeight);
        const avail = y - BODY_BOTTOM;
        if (h <= avail + 0.01) { drawRow(placed, y, h, drawChecks); y -= h; break; }
        const fresh = CONT_TOP - 16 - headerH - BODY_BOTTOM;
        // 短列整列移到下一頁；高列（約 12 行以上）在本頁至少留 5 行時才拆，避免大片空白。
        if (h <= fresh * 0.25 || avail < minSplit + LEAD * 2) { startSegment(true); continue; }
        // 過高的列：本頁填滿可容納的完整行，其餘行接續下一頁同一欄。
        const fit = Math.floor((avail - PAD_Y * 2) / LEAD);
        const part = placed.map(p => ({ ...p, lines: p.lines.slice(0, fit) }));
        drawRow(part, y, rowHeight(fit), drawChecks);
        y -= rowHeight(fit);
        // 已寫完的標籤格在續頁標示「（續）」，其他已寫完的格留白。
        placed = placed.map(p => ({ ...p, cell: { ...p.cell, deferred: undefined }, lines: p.lines.length > fit ? p.lines.slice(fit) : p.cell.fill ? ['（續）'] : [] }));
        lineCount = Math.max(1, ...placed.map(p => p.lines.length));
        drawChecks = false;
        startSegment(true);
      }
    }
    closeSegment();
    y -= 10;
  }

  /** 章節標題列；與後續內容保持在同頁。 */
  function sectionBar(text: string, keep = 90) {
    const lines = wrapChecklistText(printable(text), font, SECTION_SIZE, CONTENT_W - 16);
    const h = lines.length * 17 + 8;
    if (y - h - keep < BODY_BOTTOM) newPage();
    page.drawRectangle({ x: MX, y: y - h, width: CONTENT_W, height: h, color: BAR_FILL, borderColor: INK, borderWidth: 1 });
    lines.forEach((line, n) => drawString(page, line, MX + 8, y - 4 - (n + 1) * 17 + 4.5, SECTION_SIZE, { bold: true }));
    y -= h + 8;
  }

  function subTitle(text: string, keep = 60) {
    if (y - 18 - keep < BODY_BOTTOM) newPage();
    drawString(page, printable(text), MX, y - SUB_SIZE - 1, SUB_SIZE, { bold: true });
    y -= 18;
  }

  const fieldRows = (fields: FormField[]): Cell[][] => fields.map(f => [label(f.label), { text: f.text, url: f.url }]);
  const LABEL_W = 124;
  const fieldTable = (fields: FormField[], context: string) => table({ widths: [LABEL_W, CONTENT_W - LABEL_W], rows: fieldRows(fields), context });

  // ── 第 1 頁：表頭 ──
  page = pdf.addPage(PageSizes.A4);
  {
    const tracking = 4;
    const titleChars = Array.from(printable(form.title));
    const titleWidth = titleChars.reduce((sum, c) => sum + widthOf(c, TITLE_SIZE), 0) + tracking * (titleChars.length - 1);
    let tx = (PAGE_W - titleWidth) / 2;
    for (const c of titleChars) { drawString(page, c, tx, PAGE_H - 64, TITLE_SIZE, { bold: true }); tx += widthOf(c, TITLE_SIZE) + tracking; }
    const notice = printable(form.notice);
    drawString(page, notice, (PAGE_W - widthOf(notice, 9)) / 2, PAGE_H - 82, 9, { color: MUTED });
    y = PAGE_H - 94;
  }
  const META_L = 70;
  const META_V = (CONTENT_W - META_L * 2) / 2;
  table({
    widths: [META_L, META_V, META_L, META_V], context: '表頭',
    rows: [
      [label('文件編號'), { text: form.code }, label('產製日期'), { text: form.generatedDate }],
      [label('對象'), { text: form.target }, label('已選資源'), { text: form.itemCount }],
      [label('資料版本'), { text: form.catalogVersion, span: 3 }],
      [label('資料來源'), { text: form.sourceLabel, span: 3 }],
    ],
  });

  sectionBar('一、基本資料');
  table({
    widths: [META_L + 14, META_V - 14, META_L + 14, META_V - 14], context: '一、基本資料', minRowHeight: 28,
    rows: [
      [label(form.basicFields[0]!), {}, label(form.basicFields[1]!), {}],
      [label(form.basicFields[2]!), {}, label(form.basicFields[3]!), {}],
      [label(form.basicFields[4]!), { text: '年　　　月　　　日', span: 3, align: 'right', color: MUTED }],
    ],
  });
  table({
    widths: [36, CONTENT_W - 36], context: form.conditionsTitle,
    header: [head(form.conditionsTitle, { span: 2 })],
    rows: form.conditions.length
      ? [...form.conditions.map((line, n): Cell[] => [label(String(n + 1)), { text: line }]), [{ text: form.privacyNotice, span: 2, size: SMALL_SIZE + 0.5, color: MUTED }]]
      : [[{ text: form.privacyNotice, span: 2 }]],
  });

  const resourcePages = new Map<number, number>();
  sectionBar('二、申請項目總覽');
  table({
    widths: [32, 94, 70, 106, 80, 79, CONTENT_W - 461], context: '二、申請項目總覽',
    header: ['編號', '資源名稱', '主辦／\n承辦機關', '受理窗口', '申請期限', '初篩結果\n（非資格認定）', '頁次'].map(h => head(h)),
    rows: form.overview.length
      ? form.overview.map((row): Cell[] => [
        { text: String(row.no), align: 'center' }, { text: row.name }, { text: row.agency }, { text: row.channel },
        { text: row.deadline }, { text: row.screening }, { align: 'center', deferred: () => String(resourcePages.get(row.no) ?? '') },
      ])
      : [[{ text: form.emptyNote, span: 7, align: 'center' }]],
  });

  sectionBar('三、應備文件核對表');
  const docRow = (doc: ChecklistForm['documents'][number]): Cell[] => [
    { text: String(doc.no), align: 'center' }, { text: doc.name }, { text: doc.requirement, align: 'center' },
    { text: doc.usedBy, align: 'center' }, { check: { checked: doc.checked, label: '已備' } }, { text: doc.remarks },
  ];
  const docHeader = ['項次', '文件名稱', '必備／\n依個案', '用於\n項目編號', '已備妥', '備註'].map(h => head(h));
  const docWidths = [30, 128, 54, 50, 44, CONTENT_W - 306];
  const docRows: Cell[][] = form.documents.map(docRow);
  for (const item of form.incomplete) {
    docRows.push([{ text: '—', align: 'center' }, { text: '文件清單未補齊', bold: true }, { text: '—', align: 'center' }, { text: String(item.no), align: 'center' }, {}, { text: item.remarks }]);
  }
  table({
    widths: docWidths, context: '三、應備文件核對表',
    header: docHeader,
    rows: docRows.length ? docRows : [[{ text: form.emptyNote, span: 6, align: 'center' }]],
  });
  if (form.otherRegionDocuments.length) {
    subTitle(form.otherRegionTitle);
    table({ widths: docWidths, context: `三、應備文件核對表　${form.otherRegionTitle}`, header: docHeader, rows: form.otherRegionDocuments.map(docRow) });
  }

  // ── 各項目：每項另起新頁 ──
  for (const resource of form.resources) {
    newPage();
    resourcePages.set(resource.no, pdf.getPageCount());
    const context = `項目 ${resource.no}　${resource.name}`;
    sectionBar(`四、項目檢核　項目 ${resource.no}／${form.resources.length}　${resource.name}`);
    subTitle('（一）資源摘要');
    fieldTable(resource.summary, `${context}　（一）資源摘要`);
    subTitle('（二）資格條件');
    table({
      widths: [LABEL_W, CONTENT_W - LABEL_W], context: `${context}　（二）資格條件`,
      header: [head('條件類別'), head('原文')],
      rows: resource.eligibility.map(e => [label(e.category), { text: e.text }]),
    });
    subTitle('（三）待確認事項');
    table({
      widths: [30, 220, 44, CONTENT_W - 294], context: `${context}　（三）待確認事項`, minRowHeight: 28,
      header: [head('項次'), head('待確認事項'), head('已確認'), head('窗口回覆')],
      rows: resource.pending.length
        ? resource.pending.map((p, n): Cell[] => [{ text: String(n + 1), align: 'center' }, { text: p }, { check: { checked: false, label: '' } }, {}])
        : [[{ text: '—', align: 'center' }, { text: resource.pendingNote }, { check: { checked: false, label: '' } }, {}]],
    });
    subTitle('（四）辦理流程');
    const stepRows: Cell[][] = resource.steps.map(step => [{ text: String(step.no), align: 'center' }, { text: step.text }, { check: { checked: step.done, label: '完成' } }, { text: '年　　月　　日', align: 'right', color: MUTED }]);
    if (resource.stepsNote) stepRows.push([{ text: resource.stepsNote, span: 4, size: SMALL_SIZE + 0.5, color: MUTED }]);
    table({
      widths: [30, CONTENT_W - 30 - 52 - 80, 52, 80], context: `${context}　（四）辦理流程`, minRowHeight: 24,
      header: [head('步驟'), head('辦理內容'), head('完成'), head('日期')],
      rows: stepRows.length ? stepRows : [[{ text: '辦理步驟原文未提供，請向窗口確認。', span: 4 }]],
    });
    subTitle('（五）受理窗口與聯絡資訊');
    fieldTable([...resource.contact, ...resource.ask], `${context}　（五）受理窗口與聯絡資訊`);
    subTitle('（六）來源與查核');
    fieldTable(resource.verification, `${context}　（六）來源與查核`);
    table({
      widths: [96, CONTENT_W - 96 - 92 - 66, 92, 66], context: `${context}　（六）來源與查核`,
      header: [head('來源類別'), head('來源連結'), head('來源日期'), head('查核日期')],
      rows: resource.sources.length
        ? resource.sources.map(s => [label(s.category), { text: s.url, url: s.url }, { text: s.sourceDate, align: 'center' }, { text: s.checkedDate, align: 'center' }])
        : [[{ text: '資料未列來源紀錄，請以官方網站為準。', span: 4 }]],
    });
  }

  if (!form.resources.length) {
    // 未選資源仍保留章節，表單結構固定。
    sectionBar('四、項目檢核', 30);
    table({ widths: [CONTENT_W], context: '四、項目檢核', rows: [[{ text: form.emptyNote, align: 'center' }]] });
  }

  // ── 表末：洽詢紀錄、確認欄、注意事項，盡量同頁 ──
  if (y - CLOSING_HEIGHT < BODY_BOTTOM) newPage();
  sectionBar('五、洽詢紀錄', 140);
  table({
    widths: [64, 48, 92, 180, CONTENT_W - 384], context: '五、洽詢紀錄', minRowHeight: 32,
    header: ['日期', '項目\n編號', '窗口／承辦人', '回覆內容', '下一步'].map(h => head(h)),
    rows: Array.from({ length: 6 }, (): Cell[] => [{ text: '　月　日', align: 'right', color: MUTED }, {}, {}, {}, {}]),
  });
  sectionBar('六、確認欄', 60);
  table({
    widths: [META_L + 14, META_V + 30, META_L - 10, META_V - 34], context: '六、確認欄', minRowHeight: 46,
    rows: [[label('協助者簽名'), {}, label('日期'), { text: '年　　月　　日', align: 'right', color: MUTED }]],
  });
  sectionBar('七、注意事項', 80);
  table({
    widths: [30, CONTENT_W - 30], context: '七、注意事項',
    rows: form.notes.map((note, n) => [{ text: `${n + 1}.`, align: 'center' }, { text: note }]),
  });

  for (const cell of deferredCells) {
    const value = printable(cell.value());
    drawString(cell.page, value, cell.x + (cell.w - widthOf(value, CELL_SIZE)) / 2, cell.top - cell.h / 2 - CELL_SIZE / 2 + 2, CELL_SIZE);
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: MX, y: 44 }, end: { x: PAGE_W - MX, y: 44 }, thickness: 0.6, color: RULE });
    drawString(p, FOOTER_NOTE, MX, 31, SMALL_SIZE, { color: MUTED });
    const code = `文件編號 ${form.code}`;
    drawString(p, code, (PAGE_W - widthOf(code, SMALL_SIZE)) / 2, 31, SMALL_SIZE, { color: MUTED });
    const counter = `第 ${i + 1} 頁，共 ${pages.length} 頁`;
    drawString(p, counter, PAGE_W - MX - widthOf(counter, SMALL_SIZE + 0.5), 31, SMALL_SIZE + 0.5);
  });
  pdf.setTitle(form.title);
  pdf.setSubject('申辦準備檢核表；非機關正式表單，不代表送件或核准');
  pdf.setCreator('福利連');
  pdf.setCreationDate(input.meta.generatedAt);
  // 不把輸入、答案或完整結構寫進 metadata。
  pdf.catalog.set(PDFName.of('Lang'), PDFString.of('zh-Hant-TW'));
  return pdf.save();
}
