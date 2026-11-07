// EligibilityEvaluator：保守本機匹配。答案只在裝置上評估，不送後端。
// 原則（見契約）：未知、原文關鍵條件、partial/unverified、無法解讀的例外都不產生確定符合；
// 只有明確可判斷的條件才排除；寧可全部 possible，也不給虛假 likely。
// 原文欄位皆可能為 null，一律經 text() 安全處理。

import { isApplicantAgeRule, isTaipeiRegion } from './questions';
import { reviewedChecks, reviewFor, taipeiToday } from './reviewed-rules';
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

/** Source-bound necessary age gate; unrelated unknown income does not cancel it. */
export function ageVerdict(item: Subsidy, age: number, today = taipeiToday()): boolean | null {
  return reviewedChecks(item, { age }, today).find(c => c.rule.field === 'age')?.verdict ?? null;
}

function deadlinePassed(item: Subsidy, today: string): string | null {
  const end = item.application?.deadline?.end;
  if (typeof end !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(end)) return null;
  return end.slice(0, 10) < today ? end.slice(0, 10) : null;
}

export function evaluate(item: Subsidy, answers: Answers, today = taipeiToday()): MatchResult {
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

  const review = reviewFor(item);
  if (!review) warnings.push('資料已變更或沒有適用的來源綁定規則，原審閱規則已停用；請重新核對。');
  for (const { rule, verdict } of reviewedChecks(item, answers, today, review)) {
    const evidence = rule.evidence.map(e => quote(e.value)).join('、');
    if (verdict === null) {
      pending.push(`必要條件待確認（缺答、參考日期或出生年邊界）：${rule.label}；${evidence}`);
    } else {
      const value = rule.field === 'age' ? `目前實歲 ${answers.age}` : rule.field === 'is_student'
        ? (answers.is_student ? '自述目前在學' : '自述目前未在學') : rule.field === 'region'
        ? `自述戶籍 ${answers.region}` : `自述身分 ${answers.household_type}`;
      note(verdict ? 'reasons' : 'blocked_by', `${value}，${verdict ? '與必要條件單項相符' : '不符必要條件'}：${rule.label}；${evidence}（其他條件仍待機關核驗）`, rule.field, null);
    }
  }
  if (review?.age_review === 'deferred') pending.push(`年齡主體／途徑待確認：${review.review_note}`);
  for (const r of arr(el.age)) pending.push(`年齡原文（${text(r.subject) || '主體未註明'}）：${quote(r.raw)}`);

  // 戶籍：scope 不是完整戶籍規則，與後端相同不以戶籍排除；只提示並列出原文。
  const residence = arr(el.residence);
  const regions = arr(item.scope?.regions);
  const inTaipei = isTaipeiRegion(answers.region);
  for (const r of residence) pending.push(`居住／戶籍：${quote(r.raw)}`);
  if (!review?.requirements.some(r => r.field === 'region') && inTaipei === false && regions.includes('臺北市')) {
    note(
      'warnings',
      '戶籍與資料範圍（臺北市）不同；可能另有就學、就業或居住等途徑，不據此排除，請向窗口確認。',
      'region',
      '資料範圍為臺北市；戶籍、就學、就業或居住等適用途徑請向窗口確認。',
    );
  }

  // A type tag or a student array is not a required positive applicant status.
  for (const h of arr(el.household)) pending.push(`家庭條件（未編碼部分仍待確認）：${quote(h.raw)}`);
  for (const s of arr(el.student)) pending.push(`就學／未就學條件（請核對主體及學制）：${quote(s.raw)}`);
  if (arr(el.student).length && !review?.requirements.some(r => r.field === 'is_student')) {
    warnings.push('在學欄位尚未建立本人必要條件；可能指子女、特定學制或未就學，不以回答在學自動加相符理由。');
  }
  warnings.push('僅初篩已審閱必要條件；其他原文資格、例外、證明及受理時效仍須機關確認。');

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
