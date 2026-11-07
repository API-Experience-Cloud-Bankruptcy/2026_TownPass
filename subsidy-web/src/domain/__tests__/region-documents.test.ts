import { describe, expect, it } from 'vitest';
import { mergeDocuments } from '../documents';
import { buildChecklist } from '../checklist';
import { buildPlanText, type PlanInput } from '../export';
import { realItem } from './real-data';

describe('地方文件整合遵循對話主線的地區依據', () => {
  const item = realItem('CT-0047');
  const plan = (application_region?: string): PlanInput => ({
    meta: { catalogVersion: 'test', sourceLabel: '測試', generatedAt: new Date('2026-11-08') },
    target: 'other', items: [item], results: new Map(), conditions: [], docChecks: {}, stepDone: {},
    documentAnswers: { region: '臺北市', extra: application_region ? { application_region } : {} },
  });
  it('戶籍不能代替受理地，未回答受理地的文件保留待確認', () => {
    const merged = mergeDocuments([item], plan().documentAnswers);
    expect(merged.documents).toHaveLength(0);
    expect(merged.pendingDocuments).toHaveLength(8);
    expect(buildChecklist(plan()).form.otherRegionDocuments).toHaveLength(8);
    expect(buildPlanText(plan())).toContain('新北市政府長期照顧服務申請書');
  });
  it('回答受理地後，畫面與 PDF 主清單只列當地文件，其他地方要求仍可查', () => {
    const input = plan('新北市');
    const merged = mergeDocuments([item], input.documentAnswers);
    expect(merged.documents).toHaveLength(5);
    expect(merged.otherDocuments).toHaveLength(3);
    const form = buildChecklist(input).form;
    expect(form.documents).toHaveLength(5);
    expect(form.otherRegionDocuments).toHaveLength(3);
  });
});
