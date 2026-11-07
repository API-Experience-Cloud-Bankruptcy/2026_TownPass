import type { Profile, WelfareItem } from '../data/welfare-schema';
import { IDENTITY_LABEL, type MatchResult } from './match';

const STUDENT: Record<NonNullable<Profile['student']>, string> = {
  elementary: '國小學生',
  junior: '國中學生',
  senior: '高中職學生',
  college: '大專學生',
};

function residentPhrase(m: number): string {
  if (m === 0) return '還沒設籍臺北市';
  if (m < 4) return '設籍臺北市未滿 4 個月';
  if (m < 6) return '設籍臺北市 4 個月以上';
  if (m < 12) return '設籍臺北市半年以上';
  if (m < 24) return '設籍臺北市 1 年以上';
  return '設籍臺北市 2 年以上';
}

/** Short phrases describing what the person told us. */
export function describeProfile(p: Profile, now: Date = new Date()): string[] {
  const out: string[] = [];
  if (p.birthYear !== undefined) out.push(`${now.getFullYear() - p.birthYear} 歲左右`);
  if (p.residentMonths !== undefined) out.push(residentPhrase(p.residentMonths));
  p.identities.forEach((i) => out.push(IDENTITY_LABEL[i]));
  if (p.livesAlone === true) out.push('一個人住');
  if (p.livesAlone === false) out.push('和家人同住');
  if (p.childrenUnder && p.childrenUnder.length > 0) out.push('家裡有未成年孩子');
  if (p.employed === true) out.push('目前有工作');
  if (p.employed === false) out.push('目前沒有工作');
  if (p.student) out.push(STUDENT[p.student]);
  if (p.renter === true) out.push('租房子住');
  return out;
}

export function applyWays(item: WelfareItem): string {
  const ways: string[] = [];
  if (item.apply.online) ways.push('可線上申請');
  if (item.apply.counter) ways.push(`到${item.apply.counter}`);
  if (item.apply.phone) ways.push(`電話 ${item.apply.phone}`);
  return ways.join('，');
}

/** Text read aloud on the results page. */
export function resultsSpeech(match: MatchResult[], maybe: MatchResult[]): string {
  if (match.length + maybe.length === 0) return '目前沒有找到你可能符合的福利。可以按請人幫我，找人一起查。';
  const parts = [`找到 ${match.length} 項你很可能符合的福利，還有 ${maybe.length} 項需要再確認。`];
  [...match, ...maybe].slice(0, 6).forEach((r, i) => {
    parts.push(`第 ${i + 1} 項，${r.item.name}。${r.item.plain}${r.item.amount ? `金額是${r.item.amount}。` : ''}`);
  });
  return parts.join('');
}
