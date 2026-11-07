import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeSubsidy } from './fixtures';
import { savedPlan } from '../action-plan';
import { loadSnapshot } from '../catalog';
import { mergeDocuments } from '../documents';
import { sourceFingerprint } from '../plain-language';
import { buildRoute } from '../route';
import { emptySession } from '../session';
import { completedStepDocumentKeys, stepDocumentRules } from '../step-documents';
import type { Subsidy } from '../types';
import { resetSteps, state, toggleDoc, toggleStep } from '../../store';

let items: Subsidy[];
let byId: Map<string, Subsidy>;
beforeAll(async () => {
  items = (await loadSnapshot()).items;
  byId = new Map(items.map(item => [item.id, item]));
});
beforeEach(() => {
  state.catalog = { items, version: 'test', origin: 'snapshot', sourceLabel: 'test' };
  state.personalPlan = emptySession('self');
  state.view = 'plan';
});
const item = (id: string) => byId.get(id)!;
const keys = (id: string, step: number) => completedStepDocumentKeys(item(id), step);
const names = (id: string, step: number) => keys(id, step).map(key => JSON.parse(key)[0]);

describe('逐筆設定的步驟與文件單向同步', () => {
  it('每筆來源與所有步驟皆有覆核設定，文件索引與原名相符', () => {
    expect(Object.keys(stepDocumentRules).sort()).toEqual(items.map(x => x.id).sort());
    for (const resource of items) {
      const rule = stepDocumentRules[resource.id]!;
      expect(rule.sourceFingerprint, resource.id).toBe(sourceFingerprint(resource));
      expect(rule.steps.map(s => s.step), resource.id).toEqual(buildRoute(resource).steps);
      expect(rule.reviewNote.length).toBeGreaterThan(0);
      for (const step of rule.steps) {
        expect(new Set(step.documents.map(d => d.index)).size).toBe(step.documents.length);
        for (const doc of step.documents) expect(resource.application.required_documents[doc.index]?.name, resource.id).toBe(doc.name);
      }
    }
  });
  it('下載空白表單不完成文件，備附件與送件各自對應不同文件', () => {
    expect(names('WEL-0074', 0)).toEqual([]);
    expect(names('WEL-0074', 1)).toEqual(['114學年度第2學期成績單正本', '身分證影本', '學生證影本', '最近3個月內戶籍謄本影本']);
    expect(names('WEL-0074', 2)).toEqual(['獎學金申請書']);
    expect(names('WEL-0074', 3)).toEqual([]);
  });
  it('取得認定與申請認定不同；條件分支、不完整流程不一律打勾', () => {
    expect(keys('WEL-0085', 0)).toEqual([]);
    expect(names('WEL-0085', 2)).toContain('經濟困難證明');
    for (const id of ['WEL-0086', 'WEL-0122', 'WEL-0134', 'CT-0110', 'CT-0153', 'CT-0155']) {
      buildRoute(item(id)).steps.forEach((_, i) => expect(keys(id, i), id).toEqual([]));
    }
  });
  it('完成只勾本步驟對應文件，保留其他勾選，取消或重設步驟不取消文件', () => {
    const id = 'WEL-0074';
    state.personalPlan.planIds = [id];
    state.personalPlan.docChecks = { unrelated: true };
    toggleStep(id, 1);
    expect(state.personalPlan.stepDone[id]).toEqual([1]);
    expect(state.personalPlan.docChecks).toEqual({ unrelated: true, ...Object.fromEntries(keys(id, 1).map(key => [key, true])) });
    const checks = { ...state.personalPlan.docChecks };
    toggleStep(id, 1);
    expect(state.personalPlan.docChecks).toEqual(checks);
    toggleStep(id, 1); resetSteps(id);
    expect(state.personalPlan.docChecks).toEqual(checks);
    expect(state.personalPlan.stepDone[id]).toBeUndefined();
  });
  it('停車優惠現場查驗混有汽機車及路邊路外分支，不推定所有文件備妥', () => {
    const id = 'WEL-0132';
    state.personalPlan.planIds = [id];
    toggleStep(id, 1);
    expect(state.personalPlan.stepDone[id]).toEqual([1]);
    expect(state.personalPlan.docChecks).toEqual({});
  });
  it('特殊教育獎補助採成績或競賽路線，完成繳件不自動勾成績單', () => {
    const id = 'WEL-0008';
    state.personalPlan.planIds = [id];
    toggleStep(id, 2);
    expect(state.personalPlan.stepDone[id]).toEqual([2]);
    expect(state.personalPlan.docChecks).toEqual({});
  });
  it('文件勾選與取消皆不反向修改步驟；完成步驟後仍可手動更正文件', () => {
    const id = 'WEL-0074';
    state.personalPlan.planIds = [id];
    const key = keys(id, 1)[0]!;
    toggleDoc(key);
    expect(state.personalPlan.stepDone).toEqual({});
    toggleDoc(key);
    expect(state.personalPlan.stepDone).toEqual({});
    toggleStep(id, 1); toggleDoc(key);
    expect(state.personalPlan.stepDone[id]).toEqual([1]);
    expect(state.personalPlan.docChecks[key]).toBeUndefined();
  });
  it('來源改變、錯誤索引與未知方案不沿用舊設定', () => {
    const original = item('WEL-0074');
    const changed = structuredClone(original);
    changed.application.required_documents[1]!.notes = '已更新要求';
    expect(completedStepDocumentKeys(changed, 1)).toEqual([]);
    changed.id = 'unknown';
    expect(completedStepDocumentKeys(changed, 1)).toEqual([]);
    for (const index of [-1, 0.5, 999]) expect(completedStepDocumentKeys(original, index)).toEqual([]);
  });
  it('同名不同要求分開，地區未確認或不適用時不自動完成', () => {
    const resource = makeSubsidy({ id: 'regional-sync-test', application: {
      process_text: '備妥證明',
      required_documents: [
        { name: '證明', required: true, notes: '正本', regions: ['臺北市'], region_basis: 'registered', region_evidence: '測試地方要求' },
        { name: '證明', required: true, notes: '影本' },
      ],
    } });
    stepDocumentRules[resource.id] = {
      sourceFingerprint: sourceFingerprint(resource), reviewNote: '測試精確文件及地區',
      steps: [{ step: '備妥證明', documents: [{ index: 0, name: '證明' }] }],
    };
    try {
      expect(completedStepDocumentKeys(resource, 0)).toEqual([]);
      expect(completedStepDocumentKeys(resource, 0, { region: '高雄市' })).toEqual([]);
      const selected = completedStepDocumentKeys(resource, 0, { region: '臺北市' });
      expect(selected).toHaveLength(1);
      expect(JSON.parse(selected[0]!)[2]).toBe('正本');
    } finally { delete stepDocumentRules[resource.id]; }
  });
  it('自動勾選沿用共用文件狀態，會包含在既有保存資料', () => {
    const id = 'WEL-0010';
    state.personalPlan.planIds = [id, 'WEL-0011'];
    toggleStep(id, 0);
    const key = keys(id, 0)[0]!;
    expect(keys('WEL-0011', 0)).toContain(key);
    expect(state.personalPlan.docChecks[key]).toBe(true);
    expect(state.personalPlan.stepDone['WEL-0011']).toBeUndefined();
    const saved = savedPlan(state.personalPlan, items);
    expect(saved.docChecks[key]).toBe(true);
    expect(saved.stepDone[id]).toEqual([0]);
  });
  it('自動文件 key 沿用清單、進度與匯出使用的完整要求', () => {
    for (const resource of items) {
      const available = new Set(mergeDocuments([resource]).documents.map(doc => doc.key));
      buildRoute(resource).steps.forEach((_, i) => {
        for (const key of completedStepDocumentKeys(resource, i)) expect(available.has(key), resource.id).toBe(true);
      });
    }
  });
});
