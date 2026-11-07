// EligibilityEvaluator：保守本機匹配。答案只在裝置上評估，不送後端。
// 原則（見契約）：未知、原文關鍵條件、partial/unverified、無法解讀的例外都不產生確定符合；
// 只有明確可判斷的條件才排除；寧可全部 possible，也不給虛假 likely。
// 原文欄位皆可能為 null，一律經 text() 安全處理。

import { isApplicantAgeRule, isTaipeiRegion, LOW_TYPES } from './questions';
import type { AgeRule, Answers, MatchResult, PersonalNote, Subsidy } from './types';

/** 任意原文值轉成安全字串；null/undefined/非字串回傳空字串。 */
export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 加引號的原文；空值顯示「原文未提供文字」。 */
export function quote(value: unknown): string {
  const t = text(value);
  return t ? `「${t}」` : '（原文未提供文字）';
}

const arr = <T>(value: T[] | null | undefined): T[] => (Array.isArray(value) ? value : []);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/**
 * 與後端 matcher.rs age_bounds 等效：只接受與結構化上下限一致的「純年齡」原文片語（allowlist），
 * 回傳 [下限是否不含, 上限是否不含]；其他寫法、單位、主體或基準日一律 null（無法判斷）。
 */
export function ageBounds(rule: AgeRule): [boolean, boolean] | null {
  if (!isApplicantAgeRule(rule.subject) || rule.unit !== 'year') return null;
  const lo = num(rule.min);
  const hi = num(rule.max);
  if (lo === null && hi === null) return null;
  if ([lo, hi].some((n) => n !== null && (!Number.isFinite(n) || n < 0))) return null;
  if (lo !== null && hi !== null && lo > hi) return null;
  const raw = text(rule.raw);
  if (!raw) return null;
  const phrases: [string, boolean, boolean][] = [];
  if (lo !== null && hi === null) {
    for (const t of [`${lo}歲以上`, `年滿${lo}歲`, `年滿${lo}歲以上`]) phrases.push([t, false, false]);
    phrases.push([`超過${lo}歲`, true, false]);
  } else if (lo === null && hi !== null) {
    phrases.push([`${hi}歲以下`, false, false]);
    phrases.push([`未滿${hi}歲`, false, true]);
  } else if (lo !== null && hi !== null) {
    for (const t of [`${lo}至${hi}歲`, `${lo}歲至${hi}歲`, `${lo}–${hi}歲`]) phrases.push([t, false, false]);
    for (const t of [`年滿${lo}歲且未滿${hi}歲`, `${lo}歲以上未滿${hi}歲`, `${lo}至未滿${hi}歲`]) phrases.push([t, false, true]);
  }
  const hit = phrases.find(([t]) => t === raw);
  return hit ? [hit[1], hit[2]] : null;
}

const EMPTY_ARRAY_KEYS = ['income', 'residence', 'student', 'employment', 'disability', 'household', 'property', 'nationality', 'exclusions'];
const AGE_RULE_KEYS = ['subject', 'min', 'max', 'unit', 'raw'];

/**
 * 與後端 age_verdict 等效：只有唯一一條、完全理解的申請人年齡規則，且資格其他欄位、擴充原文、
 * 來源備註都沒有任何未解析內容時才能判斷；true 相符、false 不符、null 無法判斷。
 * 不靠關鍵字黑名單，因為替代條件可能寫在原文任何位置。
 */
export function ageVerdict(item: Subsidy, age: number): boolean | null {
  const el = item.eligibility as unknown as Record<string, unknown> | undefined;
  const ages = arr(item.eligibility?.age);
  if (!el || ages.length !== 1 || !Number.isFinite(age) || age < 0) return null;
  const rule = ages[0];
  const bounds = ageBounds(rule);
  if (!bounds) return null;
  const raw = text(rule.raw);
  for (const [key, value] of Object.entries(el)) {
    let understood: boolean;
    if (key === 'age') understood = true;
    else if (key === 'raw_summary') understood = value === null || value === undefined || (typeof value === 'string' && (!value.trim() || value.trim() === raw));
    else if (key === 'taipei_applicability') understood = value === null || value === undefined || (typeof value === 'string' && !value.trim());
    else if (EMPTY_ARRAY_KEYS.includes(key)) understood = Array.isArray(value) && value.length === 0;
    else understood = false;
    if (!understood) return null;
  }
  if (Object.keys(rule).some((k) => !AGE_RULE_KEYS.includes(k))) return null;
  if (arr(item.extensions).length > 0) return null;
  if (text(item.source_meta?.notes) || text(item.source_meta?.verification_note)) return null;
  const [exMin, exMax] = bounds;
  const lo = num(rule.min);
  const hi = num(rule.max);
  return (lo === null || (exMin ? age > lo : age >= lo)) && (hi === null || (exMax ? age < hi : age <= hi));
}

function deadlinePassed(item: Subsidy, today: string): string | null {
  const end = item.application?.deadline?.end;
  if (typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(end)) return null;
  return end.slice(0, 10) < today ? end.slice(0, 10) : null;
}

export function evaluate(item: Subsidy, answers: Answers, today = new Date().toISOString().slice(0, 10)): MatchResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const blocked: string[] = [];
  const pending: string[] = [];
  const personal: PersonalNote[] = [];
  const lists = { reasons, warnings, blocked_by: blocked };
  /** 加入含填答資訊的訊息，並記錄不含填答值的替代文字。 */
  const note = (list: PersonalNote['list'], full: string, field: string, neutral: string | null) => {
    lists[list].push(full);
    personal.push({ list, text: full, field, neutral });
  };
  const el = (item.eligibility ?? {}) as Partial<Subsidy['eligibility']>;

  // 對象原文：無法結構化的限制，一律列為待確認，不可忽略。
  const summary = text(el.raw_summary);
  if (summary) pending.push(`適用對象原文：${quote(summary)}`);

  // 年齡：與後端相同，只有 ageVerdict 能明確判斷時才相符或排除；其餘列為待確認並保留原文。
  const ageRules = arr(el.age);
  if (ageRules.length > 0) {
    const verdict = answers.age === undefined ? null : ageVerdict(item, answers.age);
    if (verdict === true) {
      note('reasons', `已填年齡 ${answers.age} 歲落在明確的申請人年齡範圍內：${quote(ageRules[0].raw)}；僅此單項相符`, 'age', null);
    } else if (verdict === false) {
      note('blocked_by', `已填年齡 ${answers.age} 歲不在明確的申請人年齡範圍內：${quote(ageRules[0].raw)}`, 'age', `依填答，年齡可能不符原文限制：${quote(ageRules[0].raw)}`);
    } else {
      if (answers.age !== undefined) {
        note('warnings', '年齡條件含不同對象、單位、基準日、例外或其他未解析原文，無法以歲數確認或排除。', 'age', null);
      }
      for (const r of ageRules) {
        const who = text(r.subject);
        pending.push(
          isApplicantAgeRule(r.subject)
            ? `年齡：${quote(r.raw)}`
            : `年齡條件針對「${who || '特定對象'}」，未套用到申請人：${quote(r.raw)}`,
        );
      }
    }
  }

  // 戶籍：scope 不是完整戶籍規則，與後端相同不以戶籍排除；只提示並列出原文。
  const residence = arr(el.residence);
  const regions = arr(item.scope?.regions);
  const inTaipei = isTaipeiRegion(answers.region);
  for (const r of residence) pending.push(`居住／戶籍：${quote(r.raw)}`);
  if (inTaipei === false && regions.includes('臺北市')) {
    note(
      'warnings',
      '戶籍與資料範圍（臺北市）不同；可能另有就學、就業或居住等途徑，不據此排除，請向窗口確認。',
      'region',
      '資料範圍為臺北市；戶籍、就學、就業或居住等適用途徑請向窗口確認。',
    );
  }

  // 家戶身分：不把一般戶直接排除（可能有其他身分或所得途徑），只提示。
  const household = arr(el.household);
  const lowRules = household.filter((h) => arr(h.types).some((t) => LOW_TYPES.includes(t)));
  for (const h of household) {
    if (!lowRules.includes(h)) pending.push(`家庭條件：${quote(h.raw)}`);
  }
  if (lowRules.length > 0) {
    const raw = lowRules.map((h) => quote(h.raw)).join('、');
    const types = new Set(lowRules.flatMap((h) => arr(h.types)));
    if (answers.household_type === 'low_income' && types.has('低收入戶')) {
      note('reasons', `已具低收入戶資格，原文列出此身分：${raw}（仍須機關核驗）`, 'household_type', null);
    } else if (answers.household_type === 'mid_low_income' && types.has('中低收入戶')) {
      note('reasons', `已具中低收入戶資格，原文列出此身分：${raw}（仍須機關核驗）`, 'household_type', null);
    } else {
      if (answers.household_type === 'general') {
        note(
          'warnings',
          `原文提到低收／中低收身分：${raw}；尚未核定時，可詢問是否有其他適用途徑或先申請身分。`,
          'household_type',
          `原文提到低收／中低收身分：${raw}；可詢問是否有其他適用途徑。`,
        );
      }
      pending.push(`家庭身分：${raw}`);
    }
  }

  // 學生：學生條件可能指申請人或子女，只作說明。
  const student = arr(el.student);
  if (student.length > 0) {
    if (answers.is_student === true) note('reasons', '目前在學，與原文的學生條件相關。', 'is_student', null);
    else if (answers.is_student === false) {
      note('warnings', '已填目前未在學；原文有學生相關條件（可能指申請人或子女），請確認是否有其他適用途徑。', 'is_student', '原文有學生相關條件（可能指申請人或子女），請確認是否適用。');
    }
    for (const s of student) pending.push(`就學條件：${quote(s.raw)}`);
  }

  // 不比較個人所得與家戶所得；以下原文條件一律待確認。
  const income = arr(el.income);
  const property = arr(el.property);
  if (income.length > 0 || property.length > 0) {
    warnings.push('所得或財產條件需由機關查核，本服務不比較所得。');
    for (const r of income) pending.push(`所得（${text(r.subject) || '對象未註明'}）：${quote(r.raw)}`);
    for (const r of property) pending.push(`財產：${quote(r.raw)}`);
  }
  for (const r of arr(el.disability)) pending.push(`身心障礙：${quote(r.raw)}`);
  for (const r of arr(el.employment)) pending.push(`就業：${quote(r.raw)}`);
  for (const r of arr(el.nationality)) pending.push(`國籍：${quote(r.raw)}`);
  for (const ex of arr(item.extensions)) {
    if (ex.namespace === 'eligibility') pending.push(`${text(ex.label) || '其他條件'}：${quote(ex.raw)}`);
  }
  for (const ex of arr(el.exclusions)) pending.push(`排除或例外：${quote(ex)}`);

  const status = item.source_meta?.verification_status;
  if (status === 'partial') warnings.push('資料原有狀態為「部分查核」，請以官方公告為準。');
  else if (status !== 'verified') warnings.push('資料原有狀態為「未查核」，請以官方公告為準。');

  const passed = deadlinePassed(item, today);
  if (passed) warnings.push(`原文期限 ${passed} 可能已過，請查官方最新公告。`);

  // 與後端一致：目前資料沒有完整可執行的資格運算式，likely 保留於型別但不發出。
  const fit: MatchResult['fit'] = blocked.length > 0 ? 'ineligible' : 'possible';

  return { id: item.id, fit, reasons, warnings, blocked_by: blocked, pending, personal };
}

const FIT_ORDER = { likely: 0, possible: 1, ineligible: 2 } as const;

export function evaluateAll(items: Subsidy[], answers: Answers, today?: string): Map<string, MatchResult> {
  const map = new Map<string, MatchResult>();
  for (const item of items) map.set(item.id, evaluate(item, answers, today));
  return map;
}

/** 依結果排序：不使用符合條件數當核准機率；先 fit，再保留原有相關度順序。 */
export function sortByFit<T extends { id: string }>(list: T[], results: Map<string, MatchResult>): T[] {
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const fa = FIT_ORDER[results.get(a.item.id)?.fit ?? 'possible'];
      const fb = FIT_ORDER[results.get(b.item.id)?.fit ?? 'possible'];
      return fa - fb || a.index - b.index;
    })
    .map((x) => x.item);
}

export const FIT_LABEL: Record<MatchResult['fit'], string> = {
  likely: '已知條件相符，仍須機關審核',
  possible: '還有條件待確認',
  ineligible: '目前條件不符',
};
