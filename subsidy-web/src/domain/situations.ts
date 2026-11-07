// 情境分類與文字搜尋（規則式，不依賴 AI）。

import { adaptiveReviewFor } from './adaptive';
import type { Subsidy } from './types';

export interface Situation {
  id: string;
  label: string;
  hint: string;
  categories: string[];
  applicants: string[];
}

export const SITUATIONS: Situation[] = [
  { id: 'living', label: '生活費與急難', hint: '生活費、急難、低收入', categories: ['低收', '急難', '生活', '稅賦'], applicants: ['低收入戶', '中低收入戶'] },
  { id: 'elder', label: '長者與照顧', hint: '敬老、長照、中高齡', categories: ['敬老', '長者', '長照', '老人', '高齡', '中高齡'], applicants: ['長者'] },
  { id: 'study', label: '就學與學費', hint: '學雜費、助學金、獎學金', categories: ['教育'], applicants: ['學生'] },
  { id: 'family', label: '育兒與家庭', hint: '生育、托育、兒少、婦女', categories: ['育兒', '生育', '兒少', '婦女'], applicants: ['兒童'] },
  { id: 'health', label: '醫療與健康', hint: '健保、篩檢、醫療補助', categories: ['醫療'], applicants: [] },
  { id: 'disability', label: '身心障礙', hint: '身障補助、輔具、照顧', categories: ['身心障礙', '身障'], applicants: ['身心障礙者'] },
  { id: 'housing', label: '住宅與租屋', hint: '租金補貼、購屋、修繕', categories: ['住宅', '租屋'], applicants: ['租屋族', '購屋族'] },
  { id:'community',label:'文化與社區',hint:'藝文、競賽、公益、環境',categories:['文化','體育','獎勵','社區'],applicants:[] },
  { id: 'work', label: '工作與失業', hint: '失業、職訓、職災、創業', categories: ['就業', '失業', '職訓', '職業災害', '勞工', '創業'], applicants: ['失業者', '勞工', '創業者'] },
];

export function matchesSituation(item: Subsidy, situation: Situation): boolean {
  const reviewed=adaptiveReviewFor(item);
  if(reviewed) return reviewed.situations.includes(situation.id);
  const category = item.classification?.category ?? '';
  if (situation.categories.some((c) => category.includes(c))) return true;
  const applicants = item.search?.facets?.applicant_types ?? [];
  return situation.applicants.some((a) => applicants.includes(a));
}

export function normalize(text: string): string {
  return text.toLowerCase().replace(/[臺]/g, '台').replace(/\s+/g, '');
}

/** 文字搜尋分數：名稱 > 關鍵字 > 分類/對象 > 內文；0 表示不符。 */
export function searchScore(item: Subsidy, query: string): number {
  const terms = query
    .split(/[\s,，、。]+/)
    .map(normalize)
    .filter(Boolean);
  if (terms.length === 0) return 1;
  const name = normalize(item.name ?? '');
  const keywords = (item.search?.keywords ?? []).map(normalize);
  const meta = normalize(
    [item.classification?.category, item.classification?.benefit_type, ...(item.search?.facets?.applicant_types ?? []), item.provider?.name].join(' '),
  );
  const body = normalize([item.search?.text, item.eligibility?.raw_summary, item.benefit?.raw].join(' '));
  let score = 0;
  for (const term of terms) {
    let s = 0;
    if (name.includes(term)) s = 8;
    else if (keywords.some((k) => k.includes(term))) s = 5;
    else if (meta.includes(term)) s = 3;
    else if (body.includes(term)) s = 1;
    if (s === 0) return 0; // 每個詞都需出現
    score += s;
  }
  return score;
}

export function filterCatalog(items: Subsidy[], situationId: string | null, query: string): Subsidy[] {
  const situation = SITUATIONS.find((s) => s.id === situationId) ?? null;
  return items
    .filter((item) => !situation || matchesSituation(item, situation))
    .map((item, index) => ({ item, index, score: searchScore(item, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.item);
}
