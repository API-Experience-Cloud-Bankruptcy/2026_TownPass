// 補助總覽獨立於個人問答：分類、時效及搜尋均不改動答案。
import { availability } from './adaptive';
import { searchScore } from './situations';
import type { Subsidy } from './types';

export const BROWSE_CATEGORIES = [
  { id: 'living', label: '生活與急難', hint: '生活扶助、急難救助、稅賦減免', pattern: /低收|急難|生活|稅賦/ },
  { id: 'study', label: '教育與助學', hint: '學費減免、獎學金、留學交換', pattern: /教育/ },
  { id: 'family', label: '生育與育兒', hint: '生育給付、托育、兒少與家庭', pattern: /生育|育兒|兒少/ },
  { id: 'housing', label: '住宅與租屋', hint: '租金補貼、購屋、住屋修繕', pattern: /住宅|租屋/ },
  { id: 'health', label: '醫療與健康', hint: '醫療補助、健保、疫苗與篩檢', pattern: /醫療/ },
  { id: 'elder', label: '長者與長照', hint: '敬老福利、照顧與長照服務', pattern: /敬老|長者|長照|老人|高齡/ },
  { id: 'disability', label: '身心障礙', hint: '身障福利、輔具與照顧支持', pattern: /身心障礙|身障/ },
  { id: 'work', label: '就業與創業', hint: '求職、失業、職訓、職災與產業', pattern: /就業|失業|職訓|職業災害|勞工|創業|企業|青年|婦女/ },
  { id: 'transport', label: '交通與節能', hint: '交通優惠、車輛、節能設備', pattern: /交通|節能/ },
  { id: 'culture', label: '文化與休閒', hint: '藝文創作、運動與語言學習', pattern: /文化|體育/ },
  { id: 'other', label: '其他補助', hint: '原住民、農漁及其他福利資源', pattern: /./ },
];

/** 每筆恰屬一類；使用資料分類而非申請人的資格或探索偏好。 */
export function browseCategory(item: Subsidy): string {
  return BROWSE_CATEGORIES.find(c => c.pattern.test(item.classification.category))?.id ?? 'other';
}
export type BrowseStatus = 'available' | 'uncertain' | 'hidden';
export function browseStatus(item: Subsidy, today: string): BrowseStatus {
  const d = item.application.deadline;
  if (d.start && /^\d{4}-\d{2}-\d{2}$/.test(d.start) && d.start > today) return 'hidden';
  if (availability(item, today) === 'closed') return 'hidden';
  const status = String(item.source_meta.application_status ?? '').trim();
  // 混合梯次、不同學校的狀態不能以「已截止」三字一律排除或視為開放。
  if (/已截止|已結束|停止受理|額滿|用罄|期限已過/.test(status)) {
    if (/受理中|申請中|其他類別|認養組|學校|各校|大學/.test(status)) return 'uncertain';
    return 'hidden';
  }
  if (/尚未開放|未開放|暫停受理/.test(status)) return 'hidden';
  if (/待確認|待公告|未公告|未查得|需洽|須再確認/.test(status)) return 'uncertain';
  // 固定受理期缺少可比較的日期，不能只憑舊公告認定仍在受理。
  if (d.type === 'fixed' && !d.end) return 'uncertain';
  if (d.type === 'unknown' || d.type === 'yearly' && !d.end) return 'uncertain';
  if (d.end && /^\d{4}-\d{2}-\d{2}$/.test(d.end)) return 'available';
  if (d.type === 'ongoing' || d.type === 'rolling') return 'available';
  return 'uncertain';
}

export function browseCatalog(items: Subsidy[], options: { today: string; category?: string | null; query?: string; includeUncertain?: boolean }): Subsidy[] {
  const query = (options.query ?? '').normalize('NFKC').trim();
  return items.map((item, index) => ({ item, index, status: browseStatus(item, options.today), score: searchScore(item, query) }))
    .filter(x => x.status !== 'hidden' && (x.status === 'available' || options.includeUncertain)
      && (!options.category || browseCategory(x.item) === options.category) && x.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(x => x.item);
}
