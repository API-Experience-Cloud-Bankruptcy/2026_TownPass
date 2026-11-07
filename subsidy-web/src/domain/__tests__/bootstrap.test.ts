import { REVIEW_VERSION } from '../reviewed-rules';
import { describe, expect, it, vi } from 'vitest';
import { ENGINE_VERSION, loadAppData, migrateSession } from '../bootstrap';
import { emptySession } from '../session';
import type { LoadedCatalog } from '../types';
import { makeSubsidy } from './fixtures';

const catalog = (version: string, ids: string[]): LoadedCatalog => ({
  version,
  items: ids.map((id) => makeSubsidy({ id })),
  origin: 'api',
  sourceLabel: 'test',
});

describe('版本遷移', () => {
  const old = { ...emptySession('self'), catalogVersion: 'old', rulesVersion: REVIEW_VERSION, engineVersion:ENGINE_VERSION, planIds: ['A', 'GONE'], stepDone: { A: [0] }, docChecks: { k: true } };

  it('版本變更時重設進度、移除不存在的資源，且不修改輸入', () => {
    const patch = migrateSession(old, catalog('new', ['A']));
    expect(patch).toMatchObject({ planIds: ['A'], stepDone: {}, docChecks: {}, catalogVersion: 'new' });
    expect(patch.notice).toContain('準備進度已重設');
    expect(old.stepDone).toEqual({ A: [0] });
  });

  it('同資料但規則換版也使準備進度失效', () => {
    const patch = migrateSession({...old,rulesVersion:'old-rules'}, catalog('old',['A']));
    expect(patch.stepDone).toEqual({}); expect(patch.docChecks).toEqual({});
    expect(patch.rulesVersion).toBe(REVIEW_VERSION);
  });

  it('同版本保留進度', () => {
    const patch = migrateSession(old, catalog('old', ['A', 'GONE']));
    expect(patch.stepDone).toEqual({ A: [0] });
    expect(patch.docChecks).toEqual({ k: true });
    expect(patch.notice).toBe('');
  });
});

describe('啟動載入', () => {
  it('題庫失敗時整體失敗，呼叫端不會拿到新 catalog', async () => {
    await expect(
      loadAppData({
        loadCatalog: async () => catalog('new', ['A']),
        loadQuestions: () => Promise.reject(new Error('questions down')),
      }),
    ).rejects.toThrow('questions down');
  });

  it('題庫完成前不回傳（不會先發布 catalog）', async () => {
    let release!: () => void;
    const loadQuestions = vi.fn(
      () => new Promise<any>((resolve) => (release = () => resolve({ version: 'q', questions: [], origin: 'local' }))),
    );
    let done = false;
    const p = loadAppData({ loadCatalog: async () => catalog('new', ['A']), loadQuestions }).then((r) => ((done = true), r));
    await new Promise((r) => setTimeout(r, 0));
    expect(loadQuestions).toHaveBeenCalled();
    expect(done).toBe(false);
    release();
    const r = await p;
    expect(r.catalog.version).toBe('new');
    expect(r.bank.version).toBe('q');
  });
});
