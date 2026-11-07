import { describe, expect, it } from 'vitest';
import { buildChecklist } from '../checklist';
import { buildPlanText, type PlanInput } from '../export';
import { plainLanguageFor } from '../plain-language';
import { titleFor } from '../questions';
import { questionTemplates } from '../adaptive';
import { evaluate } from '../match';
import { realItems, realItem } from './real-data';
import { makeSubsidy } from './fixtures';

const input = (item = realItems[0]!): PlanInput => ({
  meta: { catalogVersion: 'test', sourceLabel: '測試', generatedAt: new Date('2026-11-08T00:00:00Z') },
  target: 'other', items: [item], results: new Map(), conditions: [], docChecks: {}, stepDone: {},
});

describe('輸出文案與人稱', () => {
  it('217 筆文字、檢核預覽及 PDF 結構都有導讀，同時保留完整資格原文', () => {
    expect(realItems).toHaveLength(217);
    for (const item of realItems) {
      const data = input(item);
      const guide = plainLanguageFor(item)!;
      expect(guide, item.id).toBeTruthy();
      const text = buildPlanText(data);
      const checklist = buildChecklist(data);
      const sections = checklist.sections.flatMap(section => section.blocks.map(block => block.text)).join('\n');
      const form = [
        ...checklist.form.resources.flatMap(resource => resource.summary.map(field => `${field.label}：${field.text}`)),
        ...checklist.form.resources.flatMap(resource => resource.eligibility.map(field => field.text)),
      ].join('\n');
      for (const output of [text, sections, form]) {
        expect(output, item.id).toContain('白話導讀');
        for (const value of [guide.audience, guide.support, guide.firstStep, ...guide.cautions]) expect(output, item.id).toContain(value);
      }
      const original = item.eligibility.raw_summary;
      if (original) for (const output of [text, sections, form]) expect(output, item.id).toContain(original);
      const benefit = item.benefit.raw;
      if (benefit) for (const output of [text, sections, form]) expect(output, item.id).toContain(benefit);
    }
  });

  it('替他人準備的檢核表詢問文字使用對方，預覽與 PDF 一致', () => {
    const checklist = buildChecklist(input(makeSubsidy()));
    expect(checklist.sections[1]!.blocks.some(block => block.text.includes('對方是否符合申請資格'))).toBe(true);
    expect(checklist.form.resources[0]!.ask[0]!.text).toContain('對方是否符合申請資格');
  });

  it('全部已知題目都有對應的顯示問句，個人身分不以代碼呈現', () => {
    for (const question of questionTemplates) {
      expect(titleFor(question, 'other')).not.toContain('本人');
    }
    const result = evaluate(realItem('CT-0129'), { household_type: 'general' }, '2026-11-08');
    expect(result.blocked_by.join('')).toContain('一般（未核定）');
    expect(result.blocked_by.join('')).not.toContain('general');
  });
});
