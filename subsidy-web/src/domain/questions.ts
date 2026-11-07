// 題庫：固定模板，題目是否出現由資料中存在的條件決定；不使用 AI 生成。
// 後端 /api/questions 可用時採用其題目，前端依選定候選資源的 resource_ids 篩題。

import { apiBase, type FetchLike } from './catalog';
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
  // Hash each record once per bank build, not once per field.
  const reviewed = new Map(items.map(item => [item.id, reviewFor(item)]));
  const ids = (field: string) => items.filter(item => reviewed.get(item.id)?.requirements.some(r => r.field === field)).map(item => item.id).sort();
  const all: Question[] = [
    {
      id: 'q-region',
      field: 'region',
      kind: 'single',
      title: '戶籍設在哪裡？',
      description: '請選戶籍地，不是目前居住地。依就學、就業或居住地適用的條件，結果會另外標示待確認。',
      options: regionOptions([...reviewed.values()].flatMap(row => row?.requirements.filter(r => r.field === 'region').flatMap(r => r.values ?? []) ?? [])),
      resource_ids: ids('region'),
    },
    {
      id: 'q-age',
      field: 'age',
      kind: 'number',
      title: '目前幾歲（實歲）？',
      description: '填目前已滿的實歲，不是今年將滿或虛歲。年度出生年與日期邊界不確定時保留待確認。',
      min: 0,
      max: MAX_AGE,
      resource_ids: ids('age'),
    },
    {
      id: 'q-student',
      field: 'is_student',
      kind: 'boolean',
      title: '目前是在學學生嗎？',
      options: [
        { label: '是', value: true },
        { label: '否', value: false },
      ],
      resource_ids: ids('is_student'),
    },
    {
      id: 'q-household',
      field: 'household_type',
      kind: 'single',
      title: '是否已取得低收入戶或中低收入戶資格？',
      description: '依目前有效的政府核定證明回答。生活困難不等於已核定；不確定可略過。',
      options: [
        { label: '低收入戶', value: 'low_income' },
        { label: '中低收入戶', value: 'mid_low_income' },
        { label: '一般（未核定）', value: 'general' },
      ],
      resource_ids: ids('household_type'),
    },
  ];
  const order = ['age', 'region', 'is_student', 'household_type'];
  return all.filter(q => q.resource_ids.length > 0).sort((a,b) => order.indexOf(a.field)-order.indexOf(b.field));
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
      if (questions.length > 0 && typeof body.version === 'string' && body.version.includes(REVIEW_VERSION) && supports(questions) === supports(expected)) {
        return { version: typeof body.version === 'string' ? body.version : 'api', questions, origin: 'api' };
      }
    }
  } catch {
    // 逾時或無法連線：改用本機模板
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { version: `local-template-2/${REVIEW_VERSION}`, questions: buildLocalQuestions(items), origin: 'local' };
}

/** 依候選資源篩題：只問會影響目前候選的問題。 */
export function questionsFor(bank: Question[], candidateIds: string[]): Question[] {
  const set = new Set(candidateIds);
  return bank.filter((q) => q.resource_ids.some((id) => set.has(id)));
}

const SELF_TITLES: Record<string, string> = {
  region: '你的戶籍設在哪裡？',
  age: '你目前幾歲（實歲）？',
  is_student: '你目前是在學學生嗎？',
  household_type: '你是否已取得低收入戶或中低收入戶資格？',
};

const OTHER_TITLES: Record<string, string> = {
  region: '對方的戶籍設在哪裡？',
  age: '對方目前幾歲（實歲）？',
  is_student: '對方目前是在學學生嗎？',
  household_type: '對方是否已取得低收入戶或中低收入戶資格？',
};

/** 依查詢對象調整問句；未知欄位沿用原題目。 */
export function titleFor(question: Question, target: Target): string {
  const titles = target === 'other' ? OTHER_TITLES : SELF_TITLES;
  return titles[question.field] ?? question.title;
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
  } else {
    next.extra![field] = value as string | number | boolean;
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
