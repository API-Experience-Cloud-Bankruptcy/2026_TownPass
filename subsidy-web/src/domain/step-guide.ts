// 逐方案、逐步驟編輯的操作建議；與來源原文分開，不參與資格或完成進度判定。
import part1 from '../content/step-guides-1.json';
import part2 from '../content/step-guides-2.json';
import part3 from '../content/step-guides-3.json';
import fingerprints from '../content/step-guide-sources.json';
import { sourceFingerprint } from './plain-language';
import type { LinkKind } from './route';
import type { Subsidy } from './types';

export interface StepGuide {
  step: string;
  title: string;
  actions: string[];
  documentNames: string[];
  linkKind: LinkKind | null;
}
export const stepGuides = { ...part1, ...part2, ...part3 } as Record<string, { process: string; steps: StepGuide[] }>;
const cache = new WeakMap<Subsidy, boolean>();
export function stepGuideFor(item: Subsidy, step: string): StepGuide | null {
  if (!cache.has(item)) cache.set(item, (fingerprints as Record<string, string>)[item.id] === sourceFingerprint(item));
  const entry = stepGuides[item.id];
  if (!cache.get(item) || !entry || entry.process !== item.application.process_text) return null;
  return entry.steps.find(guide => guide.step === step) ?? null;
}
