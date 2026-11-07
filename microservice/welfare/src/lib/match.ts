import type { Identity, Profile, WelfareItem } from '../data/welfare-schema';

export type MatchStatus = 'match' | 'maybe' | 'no';

export interface MatchResult {
  item: WelfareItem;
  status: MatchStatus;
  /** Conditions the profile satisfies, as plain sentences. */
  reasons: string[];
  /** Structured conditions the profile left unanswered. */
  unknowns: string[];
  /** Conditions the profile fails. */
  failed: string[];
  /** Free-text conditions that always need a person to check. */
  toConfirm: string[];
  score: number;
}

export interface MatchOptions {
  /** Identities the person did not answer about (skipped questions). */
  unknownIdentities?: Identity[];
  now?: Date;
}

export const IDENTITY_LABEL: Record<Identity, string> = {
  low_income: '低收入戶',
  mid_low_income: '中低收入戶',
  disability: '身心障礙',
  indigenous: '原住民',
  new_resident: '新住民',
  single_parent: '特殊境遇家庭或單親',
  veteran: '榮民',
  caregiver: '家庭照顧者',
};

const STUDENT_LABEL: Record<NonNullable<Profile['student']>, string> = {
  elementary: '國小',
  junior: '國中',
  senior: '高中職',
  college: '大專',
};

function residentText(months: number): string {
  return months % 12 === 0 ? `${months / 12} 年` : `${months} 個月`;
}

export function ageOf(profile: Profile, now: Date = new Date()): number | undefined {
  return profile.birthYear === undefined ? undefined : now.getFullYear() - profile.birthYear;
}

export function matchItem(item: WelfareItem, profile: Profile, options: MatchOptions = {}): MatchResult {
  const e = item.eligibility;
  const reasons: string[] = [];
  const unknowns: string[] = [];
  const failed: string[] = [];
  const age = ageOf(profile, options.now);

  if (e.ageMin !== undefined || e.ageMax !== undefined) {
    const range =
      e.ageMin !== undefined && e.ageMax !== undefined
        ? `${e.ageMin} 到 ${e.ageMax} 歲`
        : e.ageMin !== undefined
          ? `${e.ageMin} 歲以上`
          : `${e.ageMax} 歲以下`;
    if (age === undefined) unknowns.push(`年齡要 ${range}`);
    else if ((e.ageMin !== undefined && age < e.ageMin) || (e.ageMax !== undefined && age > e.ageMax))
      failed.push(`年齡要 ${range}`);
    else reasons.push(`你約 ${age} 歲，符合 ${range}`);
  }

  if (e.residentMonthsMin !== undefined) {
    const need =
      e.residentMonthsMin === 0 ? '設籍在臺北市' : `設籍臺北市滿 ${residentText(e.residentMonthsMin)}`;
    if (profile.residentMonths === undefined) unknowns.push(need);
    // Any residency condition implies being registered in Taipei at all.
    else if (profile.residentMonths < e.residentMonthsMin || profile.residentMonths === 0) failed.push(need);
    else reasons.push(`你已${need}`);
  }

  if (e.identitiesAny && e.identitiesAny.length > 0) {
    const need = e.identitiesAny.map((i) => IDENTITY_LABEL[i]).join('、');
    const held = e.identitiesAny.filter((i) => profile.identities.includes(i));
    if (held.length > 0) reasons.push(`你是${held.map((i) => IDENTITY_LABEL[i]).join('、')}`);
    else if (e.identitiesAny.some((i) => options.unknownIdentities?.includes(i)))
      unknowns.push(`身分要是：${need}`);
    else failed.push(`身分要是：${need}`);
  }

  if (e.livesAlone !== undefined) {
    const need = e.livesAlone ? '一個人住' : '和家人同住';
    if (profile.livesAlone === undefined) unknowns.push(`要${need}`);
    else if (profile.livesAlone !== e.livesAlone) failed.push(`要${need}`);
    else reasons.push(`你${need}`);
  }

  if (e.childAgeMax !== undefined) {
    const need = `家裡有 ${e.childAgeMax} 歲以下的孩子`;
    if (profile.childrenUnder === undefined) unknowns.push(need);
    else if (profile.childrenUnder.some((a) => a <= e.childAgeMax!)) reasons.push(`你${need}`);
    else failed.push(need);
  }

  if (e.employed !== undefined) {
    const need = e.employed ? '目前有工作' : '目前沒有工作';
    if (profile.employed === undefined) unknowns.push(need);
    else if (profile.employed !== e.employed) failed.push(need);
    else reasons.push(`你${need}`);
  }

  if (e.student && e.student.length > 0) {
    const need = `是${e.student.map((s) => STUDENT_LABEL[s]).join('、')}學生`;
    if (profile.student === undefined) unknowns.push(need);
    else if (profile.student !== null && e.student.includes(profile.student)) reasons.push(`你${need}`);
    else failed.push(need);
  }

  if (e.renter !== undefined) {
    const need = e.renter ? '在臺北市租屋' : '不是租屋';
    if (profile.renter === undefined) unknowns.push(need);
    else if (profile.renter !== e.renter) failed.push(need);
    else reasons.push(`你${need}`);
  }

  const status: MatchStatus = failed.length > 0 ? 'no' : unknowns.length > 0 ? 'maybe' : 'match';
  // More satisfied conditions = stronger match; each unknown weakens it.
  const score = reasons.length * 10 - unknowns.length * 6;
  return { item, status, reasons, unknowns, failed, toConfirm: e.notes, score };
}

export function matchAll(items: WelfareItem[], profile: Profile, options: MatchOptions = {}) {
  const results = items.map((item) => matchItem(item, profile, options));
  const byScore = (a: MatchResult, b: MatchResult) => b.score - a.score || a.item.name.localeCompare(b.item.name);
  return {
    match: results.filter((r) => r.status === 'match').sort(byScore),
    maybe: results.filter((r) => r.status === 'maybe').sort(byScore),
    no: results.filter((r) => r.status === 'no'),
  };
}
