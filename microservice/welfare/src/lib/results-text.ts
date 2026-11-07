import type { MatchResult } from './match';

/** Results page heading; only items with every condition met count as likely. */
export function resultsTitle(match: MatchResult[], maybe: MatchResult[]): string {
  if (match.length > 0) return `有 ${match.length} 項你很可能符合`;
  if (maybe.length > 0) return `再回答幾題，就能確認 ${maybe.length} 項`;
  return '目前沒有找到符合的福利';
}

/** Text read aloud on the results page. */
export function resultsSpeech(match: MatchResult[], maybe: MatchResult[]): string {
  if (match.length + maybe.length === 0) return '目前沒有找到你可能符合的福利。可以按請人幫我，找人一起查。';
  const parts = [`${resultsTitle(match, maybe)}。`];
  if (match.length > 0 && maybe.length > 0) parts.push(`還有 ${maybe.length} 項需要再確認。`);
  [...match, ...maybe].slice(0, 6).forEach((r, i) => {
    parts.push(`第 ${i + 1} 項，${r.item.name}。${r.item.plain}${r.item.amount ? `金額是${r.item.amount}。` : ''}`);
  });
  return parts.join('');
}
