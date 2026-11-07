// 紙本檢核表的共用結構；不直接讀取答案，個人訊息沿用行動單的揭露控制。
import { plainLanguageFor } from './plain-language';
import { mergeDocuments, OTHER_REGION_TITLE, regionText, type MergedDocument } from './documents';
import { DISCLAIMER, disclosedLines, type PlanInput } from './export';
import { FIT_LABEL, text } from './match';
import { buildRoute, SOURCE_KIND_LABEL, SOURCE_ROLE, STATUS_LABEL, stuckAdvice } from './route';

export interface ChecklistBlock {
  kind: 'text' | 'check' | 'heading' | 'link' | 'notes';
  text: string;
  checked?: boolean;
  url?: string;
  key?: string;
}
export interface ChecklistSection { id: string; title: string; blocks: ChecklistBlock[] }
export interface Checklist {
  title: string;
  subtitle: string;
  metaLines: string[];
  privacyNotice: string;
  conditions: string[];
  sections: ChecklistSection[];
  /** 紙本表單版面使用的結構化內容，與 sections 同源。 */
  form: ChecklistForm;
}

/** 標籤／內容列；url 存在時內容為可點連結。 */
export interface FormField { label: string; text: string; url?: string }
export interface FormOverviewRow { no: number; id: string; name: string; agency: string; channel: string; deadline: string; screening: string }
export interface FormDocumentRow { no: number; key: string; name: string; requirement: string; usedBy: string; checked: boolean; remarks: string }
export interface FormIncompleteRow { no: number; name: string; remarks: string }
export interface FormStep { no: number; text: string; done: boolean }
export interface FormSourceRow { category: string; url: string; sourceDate: string; checkedDate: string }
export interface FormResource {
  no: number;
  id: string;
  name: string;
  /** 初篩、利益原文、金額、資格摘要、期限與受理狀態 */
  summary: FormField[];
  eligibility: { category: string; text: string }[];
  pending: string[];
  /** 無待確認項目時的提醒；有項目時為空字串 */
  pendingNote: string;
  steps: FormStep[];
  /** 流程原文未以箭頭分步時的註記 */
  stepsNote: string;
  contact: FormField[];
  /** 求助詢問用語與委託提醒 */
  ask: FormField[];
  verification: FormField[];
  sources: FormSourceRow[];
}
export interface ChecklistForm {
  title: string;
  notice: string;
  disclaimer: string;
  code: string;
  generatedDate: string;
  target: string;
  catalogVersion: string;
  sourceLabel: string;
  itemCount: string;
  /** 申請人等手寫欄位；不預填個人資料。 */
  basicFields: string[];
  conditionsTitle: string;
  /** 經同意列入的條件；未同意時為空陣列，改顯示 privacyNotice。 */
  conditions: string[];
  privacyNotice: string;
  overview: FormOverviewRow[];
  documents: FormDocumentRow[];
  /** 未回答戶籍或無法判斷縣市時，只適用其他縣市的文件；另表列出 */
  otherRegionTitle: string;
  otherRegionDocuments: FormDocumentRow[];
  incomplete: FormIncompleteRow[];
  emptyNote: string;
  resources: FormResource[];
  notes: string[];
}

export const FORM_TITLE = '福利資源申辦準備檢核表';
export const FORM_NOTICE = '本表由福利連整理，供申請前準備使用，並非機關正式表單。';
const PHONE_ADDRESS_MISSING = '電話與地址請依受理窗口原文或來源網站確認。';

/** 文件編號：產製日期加已選項目 id 的短雜湊（FNV-1a），同一組項目同日編號相同。 */
export function checklistCode(date: string, ids: string[]): string {
  let hash = 0x811c9dc5;
  for (const char of [...ids].sort().join(',')) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `FT-${date.replace(/-/g, '')}-${hash.toString(36).toUpperCase().padStart(7, '0').slice(-6)}`;
}

const ELIGIBILITY_LABELS: Record<string, string> = {
  age: '年齡', income: '所得', household: '家庭身分', residence: '居住／戶籍',
  student: '就學', disability: '身心障礙', employment: '就業', nationality: '國籍', property: '財產',
  exclusions: '排除條件', taipei_applicability: '臺北適用說明',
};

/** 保留所有資格欄位：有原文時用原文；僅有結構值時仍保留，避免遺漏限制。 */
function ruleText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(ruleText).filter(Boolean).join('；');
  if (typeof value === 'object') {
    const rule = value as Record<string, unknown>;
    const prose = ['raw', 'notes', 'description', 'condition', 'label'].map(key => text(rule[key])).filter(Boolean);
    if (prose.length) return [...new Set(prose)].join('；');
    // 沒有原文時，僅轉述已知資料的意義，不輸出技術結構或臆測比較方向。
    const details: string[] = [];
    if (typeof rule.min === 'number') details.push(`下限 ${rule.min}${rule.unit === 'year' ? ' 歲' : ''}`);
    if (typeof rule.max === 'number') details.push(`上限 ${rule.max}${rule.unit === 'year' ? ' 歲' : ''}`);
    if (typeof rule.region === 'string') details.push(`地區：${rule.region}`);
    if (typeof rule.registered_required === 'boolean') details.push(rule.registered_required ? '須設籍' : '資料未要求設籍');
    if (typeof rule.actual_residence_required === 'boolean') details.push(rule.actual_residence_required ? '須實際居住' : '資料未要求實際居住');
    if (typeof rule.min_duration_months === 'number') details.push(`至少 ${rule.min_duration_months} 個月`);
    return details.join('；');
  }
  return '';
}

/** 將來源中的欄位標記轉成紙本可讀名稱，不改變資格內容。 */
function paperText(value: string): string {
  return value.replace(/\.form_fields/g, '的表單填寫欄位').replace(/\.form_url/g, '的表單下載網址')
    .replace(/\.deadline_text/g, '的期限說明').replace(/原資料required/g, '原資料的必備標記')
    .replace(/為OR/g, '擇一即可');
}

export function buildChecklist(input: PlanInput): Checklist {
  const { meta } = input;
  const date = [meta.generatedAt.getFullYear(), String(meta.generatedAt.getMonth() + 1).padStart(2, '0'), String(meta.generatedAt.getDate()).padStart(2, '0')].join('-');
  const fields = new Set(input.conditions.map(c => c.field));
  const merged = mergeDocuments(input.items, input.documentAnswers ?? { region: input.region });
  const docBlocks: ChecklistBlock[] = [
    { kind: 'text', text: '方框僅記錄文件或步驟已準備，不代表已送件、符合資格或已核准。待確認方框可於詢問後註記，請記錄窗口回覆。空白處可用筆勾選。' },
  ];
  for (const doc of merged.documents) {
    docBlocks.push({ kind: 'check', key: doc.key, checked: !!input.docChecks[doc.key], text: `${doc.name}（${doc.required === true ? '必備' : doc.required === false ? '依個案需要' : '必要性未註明，請確認'}）${doc.hasVariant ? '；同名文件有不同要求，請分別核對' : ''}` });
    if (doc.condition) docBlocks.push({ kind: 'text', text: `條件：${doc.condition}` });
    if (doc.notes) docBlocks.push({ kind: 'text', text: `備註：${doc.notes}` });
    docBlocks.push({ kind: 'text', text: `用於：${doc.usedBy.map(u => u.name).join('、')}` });
  }
  for (const item of merged.incomplete) docBlocks.push({ kind: 'text', text: `注意：「${item.name}」文件清單尚未補齊，不代表免附文件。` });
  if (merged.otherRegion.length) docBlocks.push({ kind: 'heading', text: OTHER_REGION_TITLE });
  for (const doc of merged.otherRegion) {
    docBlocks.push({ kind: 'check', key: doc.key, checked: !!input.docChecks[doc.key], text: `${doc.name}（${regionText(doc.regions)}；${doc.required === true ? '必備' : doc.required === false ? '依個案需要' : '必要性未註明，請確認'}）` });
    if (doc.condition) docBlocks.push({ kind: 'text', text: `條件：${doc.condition}` });
    if (doc.notes) docBlocks.push({ kind: 'text', text: `備註：${doc.notes}` });
    docBlocks.push({ kind: 'text', text: `用於：${doc.usedBy.map(u => u.name).join('、')}` });
  }
  if (!input.items.length) docBlocks.push({ kind: 'text', text: '尚未選擇資源；請先確認要準備的項目。' });
  docBlocks.push({ kind: 'notes', text: '交接筆記：協助者＿＿＿＿　預計詢問日期＿＿＿＿　文件分工／還缺什麼：' });
  const sections: ChecklistSection[] = [{ id: 'documents', title: '共用文件準備清單', blocks: docBlocks }];
  input.items.forEach((item, index) => {
    const route = buildRoute(item, input.documentAnswers ?? { region: input.region });
    const result = input.results.get(item.id);
    const blocks: ChecklistBlock[] = [];
    const guide = plainLanguageFor(item);
    if (guide) {
      blocks.push({ kind: 'heading', text: '白話導讀（協助閱讀，完整條件請看下方原文）' });
      blocks.push({ kind: 'text', text: `適合誰先了解：${guide.audience}` });
      blocks.push({ kind: 'text', text: `可以獲得什麼：${guide.support}` });
      blocks.push({ kind: 'text', text: `第一步：${guide.firstStep}` });
      for (const caution of guide.cautions) blocks.push({ kind: 'text', text: `導讀提醒：${caution}` });
    }
    const line = (label: string, value: unknown) => { const v = text(value); if (v) blocks.push({ kind: 'text', text: `${label}：${paperText(v)}` }); };
    if (result) {
      line('初步比對（資格仍須審核）', FIT_LABEL[result.fit]);
      for (const [key, label] of [['blocked_by', '不符原因'], ['reasons', '已符合的個別條件'], ['warnings', '提醒']] as const) {
        for (const value of disclosedLines(result, key, fields)) line(label, value);
      }
    } else line('初篩', '尚無結果，請向窗口確認資格。');
    blocks.push({ kind: 'heading', text: '資源內容與完整資格' });
    line('補助內容（原文）', item.benefit?.raw || '原文未提供，請向窗口確認。');
    for (const amount of item.benefit?.amounts ?? []) { const original = ruleText(amount); if (original) line('金額補充（原文）', original); }
    line('資格摘要（原文）', item.eligibility?.raw_summary);
    let ruleCount = 0;
    for (const [key, value] of Object.entries(item.eligibility ?? {})) {
      if (key === 'raw_summary') continue;
      for (const v of Array.isArray(value) ? value : [value]) {
        const raw = ruleText(v);
        if (raw) { line(`${ELIGIBILITY_LABELS[key] ?? '其他資格條件'}（原文／資料說明）`, raw); ruleCount++; }
      }
    }
    if (!ruleCount && !text(item.eligibility?.raw_summary)) line('資格', '資料未提供完整資格，不代表無限制。');
    blocks.push({ kind: 'heading', text: '待確認與期限' });
    if (result?.pending?.length) for (const [n, p] of result.pending.entries()) blocks.push({ kind: 'check', key: `${item.id}:pending:${n}`, checked: false, text: `待確認：${paperText(p)}` });
    else line('待確認', '請向窗口核對完整資格、文件及受理情形；未列出待確認項目不代表資格已確認。');
    line('期限（原文）', route.deadline || '原文未提供，請確認是否仍受理。');
    line('資料記載的受理狀態', route.applicationStatus || '未註明');
    if (item.application?.deadline?.start) line('資料記載的開始日期', item.application.deadline.start);
    if (item.application?.deadline?.end) line('資料記載的截止日期', item.application.deadline.end);
    blocks.push({ kind: 'heading', text: '受理窗口與辦理步驟' });
    line('主管／承辦', route.agency || '未提供');
    line('受理窗口（原文）', route.channel || '未提供，請至來源網站確認');
    line('辦理方式（原文列出）', route.methods.join('、') || '未提供');
    const done = new Set(input.stepDone[item.id] ?? []);
    route.steps.forEach((step, n) => blocks.push({ kind: 'check', key: `${item.id}:step:${n}`, checked: done.has(n), text: `${n + 1}. ${step}${!route.splitFromArrow ? '（流程原文，未自行拆步）' : ''}` }));
    for (const missing of route.missing) line('注意', missing);
    blocks.push({ kind: 'heading', text: '來源與查核紀錄' });
    line('查核狀態', STATUS_LABEL[route.status] ?? `資料狀態：${route.status || '未註明'}`);
    line('查核日期', route.checkedDate || '未註明');
    line('資料版本', meta.catalogVersion);
    line('資料備註', item.source_meta?.notes);
    line('查核說明', item.source_meta?.verification_note);
    if (item.source_meta?.missing_fields?.length) line('來源標示缺漏', item.source_meta.missing_fields.join('、'));
    for (const link of route.links) blocks.push({ kind: 'link', text: `${link.label}（${SOURCE_KIND_LABEL[link.sourceKind]}）：${link.url}`, url: link.url });
    for (const source of route.sources) {
      if (!route.links.some(link => link.url === source.url)) blocks.push({ kind: 'link', text: `${SOURCE_ROLE[source.role] ?? (source.role || '資料來源')}（${SOURCE_KIND_LABEL[source.type as keyof typeof SOURCE_KIND_LABEL] ?? (source.type || '類型未註明')}）：${source.url}`, url: source.url });
      line(`來源紀錄（${SOURCE_ROLE[source.role] ?? '其他資料'}）日期／查核日期`, `${source.sourceDate || '未註明'}／${source.checkedDate || '未註明'}`);
    }
    if (route.rejectedUrls) line('網址提醒', `${route.rejectedUrls} 個無效或不安全網址未列入，請向窗口確認。`);
    for (const extension of item.extensions ?? []) line(extension.label || '補充說明', extension.raw);
    blocks.push({ kind: 'heading', text: '求助時可以照著說' });
    blocks.push({ kind: 'text', text: stuckAdvice(item, 'understand', undefined, input.target).askText });
    blocks.push({ kind: 'text', text: '若不方便到場或想請人協助，請先詢問是否接受郵寄、線上或委託，以及需要哪些文件；本表不代表已取得委託權。' });
    blocks.push({ kind: 'notes', text: '詢問紀錄：日期＿＿＿＿　承辦／窗口＿＿＿＿　下一步／約定時間：' });
    sections.push({ id: `resource:${item.id}`, title: `${index + 1}. ${item.name}`, blocks });
  });
  const privacyNotice = input.conditions.length ? '只加入已同意提供的回答；內容由使用者填寫，尚未查證。' : '未加入個人條件，本表不含個人填答。';
  return {
    title: FORM_TITLE, subtitle: DISCLAIMER,
    metaLines: [`產生日期：${date}`, `對象：${input.target === 'self' ? '本人' : '家人或其他人'}`, `資料來源：${meta.sourceLabel}`, `資料版本：${meta.catalogVersion}`, `已選資源：${input.items.length} 項`],
    privacyNotice,
    conditions: input.conditions.map(c => c.line), sections,
    form: buildForm(input, date, privacyNotice),
  };
}

function requirementLabel(required: boolean | null): string {
  return required === true ? '必備' : required === false ? '依個案' : '未註明';
}

function buildForm(input: PlanInput, date: string, privacyNotice: string): ChecklistForm {
  const { meta } = input;
  const fields = new Set(input.conditions.map(c => c.field));
  const merged = mergeDocuments(input.items, input.documentAnswers ?? { region: input.region });
  const numberOf = new Map(input.items.map((item, index) => [item.id, index + 1]));
  const row = (doc: MergedDocument, index: number): FormDocumentRow => ({
    no: index + 1, key: doc.key, name: doc.name, requirement: requirementLabel(doc.required),
    usedBy: doc.usedBy.map(u => numberOf.get(u.id)).filter(n => n !== undefined).join('、'),
    checked: !!input.docChecks[doc.key],
    remarks: [regionText(doc.regions), doc.condition && `條件：${doc.condition}`, doc.notes && `備註：${doc.notes}`, doc.hasVariant && '同名文件有不同要求，請分別核對'].filter(Boolean).join('\n'),
  });
  const documents = merged.documents.map(row);
  const otherRegionDocuments = merged.otherRegion.map(row);
  const incomplete: FormIncompleteRow[] = merged.incomplete.map(item => ({ no: numberOf.get(item.id) ?? 0, name: item.name, remarks: `「${item.name}」文件清單未補齊，不代表免附文件，請向窗口確認。` }));
  const overview: FormOverviewRow[] = [];
  const resources: FormResource[] = input.items.map((item, index) => {
    const no = index + 1;
    const route = buildRoute(item, input.documentAnswers ?? { region: input.region });
    const result = input.results.get(item.id);
    const field = (list: FormField[], label: string, value: unknown) => { const v = text(value); if (v) list.push({ label, text: paperText(v) }); };
    const screening = result ? FIT_LABEL[result.fit] : '尚無結果，請向窗口確認資格。';
    overview.push({ no, id: item.id, name: item.name, agency: route.agency || '未提供', channel: route.channel || '未提供，請至來源網站確認', deadline: route.deadline || '原文未提供，請確認是否仍受理', screening });
    const summary: FormField[] = [];
    const guide = plainLanguageFor(item);
    if (guide) {
      field(summary, '白話導讀', '協助閱讀，完整條件請看下方原文。');
      field(summary, '適合誰先了解', guide.audience);
      field(summary, '可以獲得什麼', guide.support);
      field(summary, '第一步', guide.firstStep);
      for (const caution of guide.cautions) field(summary, '導讀提醒', caution);
    }
    field(summary, '初步比對（資格仍須審核）', screening);
    if (result) {
      for (const [key, label] of [['blocked_by', '不符原因'], ['reasons', '已符合的個別條件'], ['warnings', '提醒']] as const) {
        for (const value of disclosedLines(result, key, fields)) field(summary, label, value);
      }
    }
    field(summary, '補助內容（原文）', item.benefit?.raw || '原文未提供，請向窗口確認。');
    for (const amount of item.benefit?.amounts ?? []) field(summary, '金額補充（原文）', ruleText(amount));
    field(summary, '資格摘要（原文）', item.eligibility?.raw_summary);
    field(summary, '申請期限（原文）', route.deadline || '原文未提供，請確認是否仍受理。');
    field(summary, '資料記載的受理狀態', route.applicationStatus || '未註明');
    field(summary, '資料記載的開始日期', item.application?.deadline?.start);
    field(summary, '資料記載的截止日期', item.application?.deadline?.end);
    const eligibility: FormResource['eligibility'] = [];
    for (const [key, value] of Object.entries(item.eligibility ?? {})) {
      if (key === 'raw_summary') continue;
      for (const v of Array.isArray(value) ? value : [value]) {
        const raw = ruleText(v);
        if (raw) eligibility.push({ category: ELIGIBILITY_LABELS[key] ?? '其他資格條件', text: paperText(raw) });
      }
    }
    for (const extension of item.extensions ?? []) {
      const raw = text(extension.raw);
      if (!raw) continue;
      if (extension.namespace === 'eligibility') eligibility.push({ category: `補充：${text(extension.label) || '補充說明'}`, text: paperText(raw) });
      else field(summary, text(extension.label) || '補充說明', raw);
    }
    if (!eligibility.length && !text(item.eligibility?.raw_summary)) eligibility.push({ category: '資格', text: '資料未提供完整資格，不代表無限制。' });
    const done = new Set(input.stepDone[item.id] ?? []);
    const contact: FormField[] = [];
    field(contact, '主管／承辦機關', route.agency || '未提供');
    field(contact, '受理窗口（原文）', route.channel || '未提供，請至來源網站確認');
    field(contact, '辦理方式（原文列出）', route.methods.join('、') || '未提供');
    contact.push({ label: '地址', text: `資料沒有另外列出；${PHONE_ADDRESS_MISSING}` });
    contact.push({ label: '電話', text: `資料沒有另外列出；${PHONE_ADDRESS_MISSING}` });
    for (const link of route.links) contact.push({ label: `${link.label}（${SOURCE_KIND_LABEL[link.sourceKind]}）`, text: link.url, url: link.url });
    for (const missing of route.missing) if (missing !== PHONE_ADDRESS_MISSING) contact.push({ label: '還缺少的資訊', text: missing });
    const verification: FormField[] = [];
    field(verification, '查核狀態', STATUS_LABEL[route.status] ?? `資料狀態：${route.status || '未註明'}`);
    field(verification, '查核日期', route.checkedDate || '未註明');
    field(verification, '資料版本', meta.catalogVersion);
    field(verification, '資料備註', item.source_meta?.notes);
    field(verification, '查核說明', item.source_meta?.verification_note);
    if (item.source_meta?.missing_fields?.length) field(verification, '來源標示缺漏', item.source_meta.missing_fields.join('、'));
    if (route.rejectedUrls) field(verification, '網址提醒', `${route.rejectedUrls} 個無效或不安全網址未列入，請向窗口確認。`);
    const sources: FormSourceRow[] = route.sources.map(source => ({
      category: `${SOURCE_ROLE[source.role] ?? (source.role || '資料來源')}（${SOURCE_KIND_LABEL[source.type as keyof typeof SOURCE_KIND_LABEL] ?? (source.type || '類型未註明')}）`,
      url: source.url, sourceDate: source.sourceDate || '未註明', checkedDate: source.checkedDate || '未註明',
    }));
    return {
      no, id: item.id, name: item.name, summary, eligibility,
      pending: (result?.pending ?? []).map(paperText),
      pendingNote: result?.pending?.length ? '' : '請向窗口核對完整資格、文件及受理情形；未列出待確認項目不代表資格已確認。',
      steps: route.steps.map((step, n) => ({ no: n + 1, text: step, done: done.has(n) })),
      stepsNote: route.steps.length && !route.splitFromArrow ? '流程原文，未自行拆步。' : '',
      contact,
      ask: [
        { label: '詢問時可以這樣說', text: stuckAdvice(item, 'understand', undefined, input.target).askText },
        { label: '委託或不便到場', text: '若不方便到場或想請人協助，請先詢問是否接受郵寄、線上或委託，以及需要哪些文件；本表不代表已取得委託權。' },
      ],
      verification, sources,
    };
  });
  return {
    title: FORM_TITLE, notice: FORM_NOTICE, disclaimer: DISCLAIMER,
    code: checklistCode(date, input.items.map(item => item.id)), generatedDate: date,
    target: input.target === 'self' ? '本人' : '家人或他人',
    catalogVersion: meta.catalogVersion, sourceLabel: meta.sourceLabel, itemCount: `${input.items.length} 項`,
    basicFields: ['申請人姓名', '聯絡電話', '協助者／代辦人', '與申請人關係', '預計洽詢日期'],
    conditionsTitle: '已同意加入的回答（自行填寫，尚未查證）',
    conditions: input.conditions.map(c => c.line), privacyNotice,
    overview, documents, otherRegionTitle: otherRegionDocuments.length ? OTHER_REGION_TITLE : '', otherRegionDocuments, incomplete, emptyNote: '尚未選擇資源；請先確認要準備的項目。', resources,
    notes: [
      DISCLAIMER,
      '本表不能代替申請書，也不代表已送件、受理、核准或取得福利。正式申請請使用機關公告的表單及方式。',
      '是否符合資格由主管機關審核；初步比對只依已知條件整理，不能代替資格審核。',
      '申請期限、是否受理及所需文件可能變動，詢問或送件前請查看機關最新公告。',
      '勾選只用來記錄文件或步驟已準備。詢問窗口後，請在待確認事項旁記下回覆。',
      '臨櫃辦理時請攜帶身分證明及各項文件正本，並依窗口指示準備影本。',
      '本表可能含有個人資料，請妥善保管。交給他人前請先確認內容，不再需要時請銷毀。',
    ],
  };
}
