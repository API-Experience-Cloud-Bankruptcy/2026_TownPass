import { describe, expect, it } from 'vitest';
import schema from '../../../../backend/data/subsidies.schema.json';
import { adaptiveReviewFor } from '../adaptive';
import { buildChecklist } from '../checklist';
import { COUNTIES, documentRegionFit, mergeDocuments, OTHER_REGION_TITLE } from '../documents';
import { buildPlanText, type PlanInput } from '../export';
import { reviewFor } from '../reviewed-rules';
import { buildRoute } from '../route';
import { realItem, realItems } from './real-data';

const OTHER_COUNTY_DOCS = ['新北市政府長期照顧服務申請書', '宜蘭縣長期照顧服務申請書', '失智症診斷證明書', 'CDR 1分以上之檢查報告'];
const plan = (region?: string): PlanInput => ({
  meta: { catalogVersion: 'test', sourceLabel: '測試', generatedAt: new Date('2026-11-08T10:00:00+08:00') },
  target: 'other', items: [realItem('CT-0047')], results: new Map(), conditions: [], docChecks: {}, stepDone: {}, region,
});

describe('文件適用縣市資料', () => {
  const documentSchema = (schema as { $defs: { document: { required: string[]; properties: Record<string, { type?: string | string[]; minItems?: number; uniqueItems?: boolean; items?: { enum?: string[] } }> } } }).$defs.document;

  it('schema 的 regions 為選填、非空、不重複且限縣市名稱，與前端清單一致', () => {
    expect(documentSchema.required).not.toContain('regions');
    const regions = documentSchema.properties.regions!;
    expect(regions).toMatchObject({ type: 'array', minItems: 1, uniqueItems: true });
    expect(regions.items?.enum).toEqual([...COUNTIES]);
  });

  it('資料中每個 regions 都符合 schema 定義', () => {
    let tagged = 0;
    for (const item of realItems) for (const doc of item.application.required_documents ?? []) {
      if (!('regions' in doc)) continue;
      tagged++;
      const regions = doc.regions as unknown[];
      expect(Array.isArray(regions) && regions.length > 0).toBe(true);
      expect(new Set(regions).size).toBe(regions.length);
      for (const r of regions) expect(COUNTIES as readonly unknown[]).toContain(r);
    }
    expect(tagged).toBe(8);
  });

  it('長照 2.0 的新北、宜蘭文件已標示縣市，審閱紀錄仍綁定', () => {
    const item = realItem('CT-0047');
    expect(item.application.required_documents.map(d => d.regions)).toEqual([
      ['新北市'], ['新北市'], ['新北市'], ['新北市'], ['新北市'], ['宜蘭縣'], ['宜蘭縣'], ['宜蘭縣'],
    ]);
    expect(reviewFor(item)).not.toBeNull();
    expect(adaptiveReviewFor(item)).not.toBeNull();
  });
});

describe('依戶籍篩選文件', () => {
  it('判斷規則：未限定一律適用；未回答或只知臺北市以外另列；已知其他縣市不列', () => {
    const doc = { name: 'x', required: true, condition: null, notes: '', regions: ['新北市'] };
    expect(documentRegionFit({ ...doc, regions: undefined }, '臺北市')).toBe('applies');
    expect(documentRegionFit(doc, undefined)).toBe('other_region');
    expect(documentRegionFit(doc, '其他縣市')).toBe('other_region');
    expect(documentRegionFit(doc, '新北市')).toBe('applies');
    expect(documentRegionFit(doc, '台北市')).toBe('excluded');
    expect(documentRegionFit(doc, '臺北市')).toBe('excluded');
  });

  it('臺北市使用者在詳情、行動單、檢核表都看不到新北與宜蘭文件', () => {
    const route = buildRoute(realItem('CT-0047'), '臺北市');
    expect(route.documents).toEqual([]);
    expect(route.otherRegionDocuments).toEqual([]);
    expect(route.missing).toContain('文件清單尚未補齊，不代表免附文件。');
    const merged = mergeDocuments([realItem('CT-0047')], '臺北市');
    expect(merged.documents).toEqual([]);
    expect(merged.otherRegion).toEqual([]);
    expect(merged.incomplete.map(i => i.id)).toEqual(['CT-0047']);
    const text = buildPlanText(plan('臺北市'));
    const checklist = buildChecklist(plan('臺北市'));
    const formDocs = JSON.stringify([checklist.form.documents, checklist.form.otherRegionDocuments, checklist.sections[0]]);
    for (const name of OTHER_COUNTY_DOCS) {
      expect(text).not.toContain(name);
      expect(formDocs).not.toContain(name);
    }
    expect(text).not.toContain(OTHER_REGION_TITLE);
    expect(checklist.form.otherRegionDocuments).toEqual([]);
    expect(checklist.form.incomplete.map(i => i.name)).toEqual([realItem('CT-0047').name]);
  });

  it('未回答戶籍時，其他縣市文件另列於「其他縣市的規定」', () => {
    const route = buildRoute(realItem('CT-0047'));
    expect(route.documents).toEqual([]);
    expect(route.otherRegionDocuments.map(d => d.name)).toEqual(realItem('CT-0047').application.required_documents.map(d => d.name));
    const merged = mergeDocuments([realItem('CT-0047')]);
    expect(merged.documents).toEqual([]);
    expect(merged.otherRegion).toHaveLength(8);
    expect(merged.otherRegion.filter(d => d.regions.includes('宜蘭縣'))).toHaveLength(3);

    const text = buildPlanText(plan());
    const [main, other] = text.split(`${OTHER_REGION_TITLE}：`);
    expect(other).toBeDefined();
    for (const name of OTHER_COUNTY_DOCS) {
      expect(main).not.toContain(`] ${name}`);
      expect(other).toContain(name);
    }
    expect(other).toContain('適用：新北市');
    expect(other).toContain('適用：宜蘭縣');

    const { form, sections } = buildChecklist(plan());
    expect(form.documents).toEqual([]);
    expect(form.otherRegionTitle).toBe(OTHER_REGION_TITLE);
    expect(buildChecklist(plan('臺北市')).form.otherRegionTitle).toBe('');
    expect(form.otherRegionDocuments.map(d => d.name)).toEqual(merged.otherRegion.map(d => d.name));
    expect(form.otherRegionDocuments.every(d => /^適用：(新北市|宜蘭縣)/.test(d.remarks))).toBe(true);
    expect(sections[0]!.blocks.some(b => b.kind === 'heading' && b.text === OTHER_REGION_TITLE)).toBe(true);
  });

  it('回答新北市時只列新北文件；只知臺北市以外時仍另列', () => {
    const ntpc = mergeDocuments([realItem('CT-0047')], '新北市');
    expect(ntpc.documents).toHaveLength(5);
    expect(ntpc.documents.every(d => d.regions.join() === '新北市')).toBe(true);
    expect(ntpc.otherRegion).toEqual([]);
    const elsewhere = mergeDocuments([realItem('CT-0047')], '其他縣市');
    expect(elsewhere.documents).toEqual([]);
    expect(elsewhere.otherRegion).toHaveLength(8);
  });

  it('未標示縣市的文件不受戶籍影響', () => {
    const item = realItem('CT-0104');
    const all = mergeDocuments([item]).documents.map(d => d.key);
    expect(all.length).toBeGreaterThan(0);
    expect(mergeDocuments([item], '臺北市').documents.map(d => d.key)).toEqual(all);
  });
});
