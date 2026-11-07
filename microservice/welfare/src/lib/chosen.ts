import { itemsInCategories, WELFARE_ITEMS } from '../data';
import type { WelfareItem } from '../data/welfare-schema';
import type { Answers } from './app-state';
import { matchAll } from './match';

/** Items picked by the person; when none are picked, fall back to the likely matches. */
export function chosenItems(chosen: string[], answers: Answers, categories: Parameters<typeof itemsInCategories>[1]): {
  items: WelfareItem[];
  picked: boolean;
} {
  if (chosen.length > 0) {
    return { items: WELFARE_ITEMS.filter((i) => chosen.includes(i.id)), picked: true };
  }
  const { match } = matchAll(itemsInCategories(WELFARE_ITEMS, categories), answers.profile, {
    unknownIdentities: answers.unknownIdentities,
  });
  return { items: match.map((r) => r.item), picked: false };
}

/** Documents across items, each listed once with the items that need it. */
export function mergedDocuments(items: WelfareItem[]): { doc: string; for: string[] }[] {
  const map = new Map<string, string[]>();
  for (const item of items) {
    for (const doc of item.documents) map.set(doc, [...(map.get(doc) ?? []), item.name]);
  }
  return [...map.entries()].map(([doc, names]) => ({ doc, for: names })).sort((a, b) => b.for.length - a.for.length);
}
