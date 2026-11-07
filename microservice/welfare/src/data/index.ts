import type { Category, WelfareItem } from './welfare-schema';

export { QUESTIONS } from './questions';
export { WELFARE_ITEMS } from './welfare-items';

export interface CategoryInfo {
  id: Category;
  label: string;
  question: string;
  glyph: string;
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'hardship', label: '生活困難', question: '生活費不夠用', glyph: '家' },
  { id: 'work', label: '工作相關', question: '找工作、失業', glyph: '職' },
  { id: 'senior', label: '銀髮福利', question: '65 歲以上長輩', glyph: '壽' },
  { id: 'care', label: '醫療與照護', question: '看病、長照、身障', glyph: '醫' },
  { id: 'parenting', label: '育兒相關', question: '懷孕、生產、托育', glyph: '幼' },
  { id: 'learning', label: '社會教育', question: '上課、學習', glyph: '學' },
  { id: 'housing', label: '居住或交通', question: '房租、交通', glyph: '住' },
  { id: 'education', label: '教育扶助', question: '學費、午餐', glyph: '書' },
  { id: 'digital', label: '上網與設備', question: '手機、上網、電腦', glyph: '網' },
];

export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<
  Category,
  string
>;

export function itemsInCategories(items: WelfareItem[], categories: Category[]): WelfareItem[] {
  if (categories.length === 0) return items;
  return items.filter((i) => i.categories.some((c) => categories.includes(c)));
}
