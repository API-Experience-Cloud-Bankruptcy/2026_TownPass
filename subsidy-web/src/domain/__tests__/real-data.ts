import original from '../../../../backend/data/subsidies.json';
import type { Subsidy } from '../types';
export const realItems = original as Subsidy[];
export function realItem(id: string): Subsidy {
  const item = realItems.find(x => x.id === id);
  if (!item) throw new Error(`Missing real resource ${id}`);
  return structuredClone(item);
}
