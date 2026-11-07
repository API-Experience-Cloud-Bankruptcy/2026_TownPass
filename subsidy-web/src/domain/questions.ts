// 題庫：固定模板，題目是否出現由資料中存在的條件決定；不使用 AI 生成。
// 後端 /api/questions 可用時採用其題目，前端依選定候選資源的 resource_ids 篩題。

import { validExtraValue } from './answer-fields';
import { apiBase, type FetchLike } from './catalog';
import { adaptiveReviewFor, ADAPTIVE_VERSION, questionTemplates, TEMPLATE_VERSION } from './adaptive';
import { reviewFor, REVIEW_VERSION } from './reviewed-rules';
import type { Answers, Question, QuestionBank, QuestionOption, Subsidy, Target } from './types';

/** 年齡上限，與後端及 API 題庫一致。 */
export const MAX_AGE = 130;

export const LOW_TYPES = ['低收入戶', '中低收入戶'];

/** 戶籍字串是否為臺北市；undefined 表示未知。 */
export function isTaipeiRegion(region: string | undefined): boolean | undefined {
  if (region === undefined || !region.trim()) return undefined;
  return /^(臺北市|台北市)/.test(region.trim());
}

/** 年齡規則是否針對申請人本人（兒童、子女、配偶等不套用到申請人）。 */
export function isApplicantAgeRule(subject: string | null | undefined): boolean {
  return subject === '申請人';
}

function regionOptions(regions: string[]): QuestionOption[] {
  return [...[...new Set(regions)].sort(), '其他縣市'].map(r => ({ label: r === '其他縣市' ? '臺北市以外' : r, value: r }));
}

/** 本機固定模板題庫，與契約穩定欄位一致：age、region、is_student、household_type。 */
export function buildLocalQuestions(items: Subsidy[]): Question[] {
  const reviewed = new Map(items.map(item => [item.id, reviewFor(item)]));
  const adaptive = new Map(items.map(item => [item.id, adaptiveReviewFor(item)]));
  return questionTemplates.map(template => {
    const field = template.field;
    const gateIds = items.filter(item => reviewed.get(item.id)?.requirements.some(r=>r.field===field)).map(i=>i.id);
    const ids = items.filter(item => ['need_area','explore_context','expense_priority'].includes(field) ? !!adaptive.get(item.id) : adaptive.get(item.id)?.facets.some(f=>f.field===field) || adaptive.get(item.id)?.ranking_preferences?.some(p=>p.field===field)).map(i=>i.id);
    const purpose = gateIds.length ? 'qualification' as const : 'discovery' as const;
    let options = template.options;
    if(field === 'region') options = regionOptions([...reviewed.values()].flatMap(row=>row?.requirements.filter(r=>r.field==='region').flatMap(r=>r.values??[])??[]));
    return {...template, purpose, options, resource_ids:[...new Set([...gateIds,...ids])].sort()};
  }).filter(q=>q.resource_ids.length>0);
}

const KINDS = new Set(['single', 'boolean', 'number']);

/** 驗證後端題目；不合格者丟棄，不讓單題錯誤影響整份題庫。 */
export function sanitizeQuestions(value: unknown): Question[] {
  if (!value || typeof value !== 'object') return [];
  const list = (value as { questions?: unknown }).questions;
  if (!Array.isArray(list)) return [];
  const out: Question[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const q = raw as Record<string, unknown>;
    if (typeof q.id !== 'string' || typeof q.field !== 'string' || typeof q.title !== 'string') continue;
    if (typeof q.kind !== 'string' || !KINDS.has(q.kind)) continue;
    if (!Array.isArray(q.resource_ids) || !q.resource_ids.every((id) => typeof id === 'string')) continue;
    let options: Question['options'];
    if (q.options !== undefined) {
      if (!Array.isArray(q.options)) continue;
      options = q.options.filter(
        (o): o is { label: string; value: string | boolean } =>
          !!o &&
          typeof o === 'object' &&
          typeof (o as { label?: unknown }).label === 'string' &&
          ['string', 'boolean'].includes(typeof (o as { value?: unknown }).value),
      );
    }
    if ((q.kind === 'single' || q.kind === 'boolean') && (!options || options.length === 0)) continue;
    let depends:Question['depends_on'];
    if(q.depends_on!==undefined) {
      if(!q.depends_on||typeof q.depends_on!=='object'||Array.isArray(q.depends_on)) continue;
      const entries=Object.entries(q.depends_on);
      if(entries.some(([,values])=>!Array.isArray(values)||!values.length||values.some(v=>typeof v!=='string'&&typeof v!=='boolean'))) continue;
      depends=Object.fromEntries(entries) as Question['depends_on'];
    }
    out.push({
      id: q.id,
      field: q.field,
      kind: q.kind as Question['kind'],
      title: q.title,
      description: typeof q.description === 'string' ? q.description : undefined,
      options,
      min: typeof q.min === 'number' ? q.min : undefined,
      max: typeof q.max === 'number' ? q.max : undefined,
      resource_ids: q.resource_ids as string[],
      purpose: q.purpose === 'qualification' ? 'qualification' : 'discovery',
      burden: typeof q.burden === 'number' ? q.burden : 1,
      situations: Array.isArray(q.situations) && q.situations.every(v=>typeof v==='string') ? q.situations : undefined,
      depends_on: depends,
    });
  }
  return out;
}

export async function loadQuestions(
  items: Subsidy[],
  options: { fetchImpl?: FetchLike; base?: string; timeoutMs?: number } = {},
): Promise<QuestionBank> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const base = options.base ?? apiBase();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs ?? 8000) : undefined;
  try {
    const response = await fetchImpl(`${base}/api/questions`, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    if (response.ok) {
      const body = (await response.json()) as { version?: unknown };
      const questions = sanitizeQuestions(body);
      const expected = buildLocalQuestions(items);
      const supports = (qs: Question[]) => qs.map(q => `${q.field}:${[...q.resource_ids].sort().join(',')}`).sort().join('|');
      if (questions.length > 0 && typeof body.version === 'string' && body.version.includes(REVIEW_VERSION) && body.version.includes(ADAPTIVE_VERSION) && body.version.includes(TEMPLATE_VERSION) && supports(questions) === supports(expected)) {
        return { version: typeof body.version === 'string' ? body.version : 'api', questions, origin: 'api' };
      }
    }
  } catch {
    // 逾時或無法連線：改用本機模板
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { version: `local-template-3/${REVIEW_VERSION}/${ADAPTIVE_VERSION}/${TEMPLATE_VERSION}`, questions: buildLocalQuestions(items), origin: 'local' };
}

/** 依候選資源篩題：只問會影響目前候選的問題。 */
export function questionsFor(bank: Question[], candidateIds: string[]): Question[] {
  const set = new Set(candidateIds);
  return bank.filter((q) => q.resource_ids.some((id) => set.has(id)));
}

/** 固定文案只改人稱與說法；欄位、選項及資格判斷仍沿用題庫。 */
export function titleFor(question: Question, target: Target): string {
  const who = target === 'other' ? '對方' : '你';
  const titles: Record<string, string> = {
    need_area: `${who}想先處理哪一類事情？`,
    community_support: `${who}想先了解哪一類文化或社區資源？`,
    benefit_style: `${who}想先了解哪種協助方式？`,
    elder_support: `${who}在長者生活方面，最需要哪種協助？`,
    region: `${who}的戶籍在哪裡？`,
    age: `${who}目前幾歲（實歲）？`,
    is_student: `${who}目前還在學嗎？`,
    household_type: `${who}已取得低收入戶或中低收入戶資格嗎？`,
    has_farmer_insurance: `${who}曾參加農保，有農保投保年資嗎？`,
    veteran_status: `${who}有輔導條例第2條規定的退除役官兵身分嗎？`,
    education_level: '想申請補助的學期或學年，是哪個教育階段？',
    education_support: `${who}就學方面最需要哪種協助？`,
    employment_status: `${who}目前的工作情況比較接近哪一項？`,
    work_support: `${who}工作方面想先處理什麼？`,
    housing_status: `${who}目前的居住情況比較接近哪一項？`,
    housing_support: `${who}住屋方面想先處理什麼？`,
    care_context: `${who}目前需要哪種照顧安排？`,
    family_stage: `${who}家中目前需要哪方面的協助？`,
    health_support: `${who}健康方面最需要哪種協助？`,
    living_support: `${who}生活方面想先處理哪件事？`,
    disability_certificate: `${who}目前有有效的身心障礙證明嗎？`,
    disability_support: `${who}身心障礙方面想先了解什麼？`,
    is_unemployed: `這次想申請補助的期間，${who}有待業或失業嗎？`,
    is_renting: `這次想申請補助的房子，是${who}或申請家庭租的嗎？`,
    owns_home: `${who}名下有住宅嗎？`,
    explore_context: `${who}目前的生活情況比較接近哪一項？`,
    expense_priority: `${who}最近最想減輕哪一筆生活開銷？`,
    work_applicant: '這次想找哪一類對象的工作相關資源？',
  };
  return titles[question.field] ?? question.title;
}

/** 提示與問句使用同一查詢對象；API 題庫與本機題庫都套用。 */
export function descriptionFor(question: Question, target: Target): string {
  const who = target === 'other' ? '對方' : '你';
  const descriptions: Record<string, string> = {
    need_area: '先選一個想了解的方向，不確定可以跳過。',
    education_level: '請依這次想申請補助的學期或學年回答。',
    education_support: '先選最想處理的就學支出，其他方向還是看得到。',
    employment_status: `請依${who}目前的工作情況回答。`,
    housing_status: `請依${who}目前的居住情況回答，不確定可以跳過。`,
    disability_certificate: '請依目前有效的證明回答；還在申請或不確定可以跳過。',
    is_unemployed: '請依這次想申請補助的期間回答，不只看今天有沒有工作。不確定可以跳過。',
    is_renting: '請依這次想申請補助的住宅與期間回答，不確定可以跳過。',
    benefit_style: '先選想了解的協助方式，其他資源還是看得到。',
    elder_support: '先選最想處理的事情，例如生活費、交通或照顧。',
    age: `請填${who}目前已滿的歲數，不清楚可以先跳過。`,
    region: '這裡問的是戶籍，不一定和現在住的地方相同。',
    is_student: `請依${who}目前的在學情況回答。`,
    household_type: '請依目前有效的政府核定證明回答；生活困難不代表已有資格。不確定可以先跳過。',
    has_farmer_insurance: '老農津貼還會核對農保年資與是否持續加保。有投保年資不代表符合資格，不清楚可以先跳過。',
    veteran_status: '這是榮民就養給付需要的身分，和一般服過兵役不同。不確定身分類別可以先跳過。',
    owns_home: `這裡問的是${who}有沒有住宅所有權，和目前住哪裡不同。`,
    explore_context: '不用先知道補助名稱，先從生活情況找。不確定可以選「這些都不確定，先看看」或跳過。',
    expense_priority: '先從最困擾的支出找，不用先知道補助名稱。',
    work_applicant: '有些補助給勞工，有些由雇主、事業或家屬申請，先選要找哪一類。',
  };
  if (descriptions[question.field]) return descriptions[question.field]!;
  return question.description?.replace('先選最需要協助的方向，其他資源仍可在結果查看；不知道可以先跳過。', '先選最需要的協助，其他資源還是看得到。不清楚可以先跳過。') ?? '';
}

/** 題目目前的答案；未回答或不知道回傳 undefined。 */
export function answerOf(answers: Answers, field: string): string | number | boolean | undefined {
  if (field === 'age') return answers.age;
  if (field === 'region') return answers.region;
  if (field === 'is_student') return answers.is_student;
  if (field === 'household_type') return answers.household_type;
  return answers.extra?.[field];
}

/** 寫入答案；value 為 undefined 代表不知道／略過，移除該欄位。回傳新物件。 */
export function setAnswer(answers: Answers, question: Question, value: string | number | boolean | undefined): Answers {
  const next: Answers = { ...answers, extra: { ...(answers.extra ?? {}) } };
  const field = question.field;
  const clear = value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value));
  if (field === 'age') {
    if (clear || typeof value !== 'number') delete next.age;
    else {
      const min = question.min ?? 0;
      const max = question.max ?? MAX_AGE;
      if (value < min || value > max || !Number.isFinite(value)) delete next.age;
      else next.age = Math.floor(value);
    }
  } else if (field === 'region') {
    // 保留題目選項的原始字串，不轉成內部代碼。
    if (typeof value === 'string' && value.trim()) next.region = value.trim();
    else delete next.region;
  } else if (field === 'is_student') {
    if (typeof value === 'boolean') next.is_student = value;
    else delete next.is_student;
  } else if (field === 'household_type') {
    if (value === 'low_income' || value === 'mid_low_income' || value === 'general') next.household_type = value;
    else delete next.household_type;
  } else if (clear) {
    delete next.extra![field];
  } else if(validExtraValue(field,value)) {
    next.extra![field] = value;
  } else {
    delete next.extra![field];
  }
  if (next.extra && Object.keys(next.extra).length === 0) delete next.extra;
  return next;
}

/**
 * 解析數字題輸入。v-model 搭配 type=number 可能給 number 或 string（含空字串），一律安全處理。
 * 回傳整數，或錯誤訊息。
 */
export function parseNumberAnswer(
  input: unknown,
  min = 0,
  max = MAX_AGE,
): { ok: true; value: number } | { ok: false; error: string } {
  const raw = typeof input === 'number' ? input : typeof input === 'string' ? input.trim() : '';
  if (raw === '' || (typeof raw === 'number' && Number.isNaN(raw))) {
    return { ok: false, error: '請輸入數字，或選「不知道／略過」。' };
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    return { ok: false, error: `請輸入 ${min} 到 ${max} 的整數。` };
  }
  return { ok: true, value: n };
}

/** 答案的可讀文字，用於摘要與求助預覽。 */
export function describeAnswer(question: Question, value: string | number | boolean | undefined): string {
  if (value === undefined) return '不知道／略過';
  if (question.kind === 'number') return `${value}${question.field === 'age' ? ' 歲' : ''}`;
  const option = question.options?.find((o) => o.value === value);
  return option?.label ?? String(value);
}
