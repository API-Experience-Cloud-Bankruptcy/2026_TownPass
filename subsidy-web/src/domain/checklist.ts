// 紙本檢核表的共用結構；不直接讀取答案，個人訊息沿用行動單的揭露控制。
import { mergeDocuments } from './documents';
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
  const merged = mergeDocuments(input.items);
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
  if (!input.items.length) docBlocks.push({ kind: 'text', text: '尚未選擇資源；請先確認要準備的項目。' });
  docBlocks.push({ kind: 'notes', text: '交接筆記：協助者＿＿＿＿　預計詢問日期＿＿＿＿　文件分工／還缺什麼：' });
  const sections: ChecklistSection[] = [{ id: 'documents', title: '共用文件準備清單', blocks: docBlocks }];
  input.items.forEach((item, index) => {
    const route = buildRoute(item);
    const result = input.results.get(item.id);
    const blocks: ChecklistBlock[] = [];
    const line = (label: string, value: unknown) => { const v = text(value); if (v) blocks.push({ kind: 'text', text: `${label}：${paperText(v)}` }); };
    if (result) {
      line('保守初篩（非資格認定）', FIT_LABEL[result.fit]);
      for (const [key, label] of [['blocked_by', '不符原因'], ['reasons', '已知相符的單項'], ['warnings', '提醒']] as const) {
        for (const value of disclosedLines(result, key, fields)) line(label, value);
      }
    } else line('初篩', '尚無結果，請向窗口確認資格。');
    blocks.push({ kind: 'heading', text: '資源內容與完整資格' });
    line('資源利益（原文）', item.benefit?.raw || '原文未提供，請向窗口確認。');
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
    line('受理狀態（資料原值）', route.applicationStatus || '未註明');
    if (item.application?.deadline?.start) line('期限起日（資料值）', item.application.deadline.start);
    if (item.application?.deadline?.end) line('期限迄日（資料值）', item.application.deadline.end);
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
    blocks.push({ kind: 'text', text: stuckAdvice(item, 'understand').askText });
    blocks.push({ kind: 'text', text: '若不方便到場或想請人協助，請先詢問是否接受郵寄、線上或委託，以及需要哪些文件；本表不代表已取得委託權。' });
    blocks.push({ kind: 'notes', text: '詢問紀錄：日期＿＿＿＿　承辦／窗口＿＿＿＿　下一步／約定時間：' });
    sections.push({ id: `resource:${item.id}`, title: `${index + 1}. ${item.name}`, blocks });
  });
  return {
    title: '福利行動檢核表', subtitle: DISCLAIMER,
    metaLines: [`產生日期：${date}`, `對象：${input.target === 'self' ? '本人' : '家人或其他人'}`, `資料來源：${meta.sourceLabel}`, `資料版本：${meta.catalogVersion}`, `已選資源：${input.items.length} 項`],
    privacyNotice: input.conditions.length ? '僅加入下列經使用者同意的條件；自行填寫，未經查證。' : '未加入個人條件，本表不含個人填答。',
    conditions: input.conditions.map(c => c.line), sections,
  };
}
