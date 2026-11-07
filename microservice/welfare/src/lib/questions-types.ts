import type { Category, Identity, Profile } from '../data/welfare-schema';

export interface ChoiceOption {
  label: string;
  /** Profile fields this choice sets. */
  patch: Partial<Profile>;
}

export type Question =
  | { id: string; kind: 'birthYear'; title: string; categories?: Category[] }
  | { id: string; kind: 'single'; title: string; hint?: string; field: keyof Profile; options: ChoiceOption[]; categories?: Category[] }
  | {
      id: string;
      kind: 'identities';
      title: string;
      options: { label: string; identity: Identity }[];
      categories?: Category[];
    }
  | { id: string; kind: 'identityYesNo'; title: string; identity: Identity; categories?: Category[] }
  | { id: string; kind: 'children'; title: string; options: { label: string; age: number }[]; categories?: Category[] };

/** Questions without `categories` are always asked; others only for the chosen categories. */
export function questionsFor(all: Question[], categories: Category[]): Question[] {
  if (categories.length === 0) return all;
  return all.filter((q) => !q.categories || q.categories.some((c) => categories.includes(c)));
}
