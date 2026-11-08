import { describe, expect, it, vi } from 'vitest';
import { ActionPlanSync, PlanApi, PlanError, savedPlan, type PlanResponse, type SavedPlan } from '../action-plan';
import { emptySession } from '../session';
import { mockReply } from '../../townpass/mock';
import type { Account } from '../../townpass/types';
import { makeSubsidy } from './fixtures';
import { mergeDocuments } from '../documents';

const plan = (ids: string[] = []): SavedPlan => savedPlan({ ...emptySession('self'), planIds: ids });
const response = (p: SavedPlan | null, revision = 0): PlanResponse => ({ mode: 'demo', profile: mockReply('userinfo', null) as Account, plan: p, revision });

describe('行動單傳輸白名單', () => {
  it('不傳資格答案、查詢文字、聊天或填表個資，移除已不在清單的勾選與步驟', () => {
    const item = makeSubsidy({ id: 'A' });
    const key = mergeDocuments([item]).documents[0]!.key;
    const s = { ...emptySession('self'), answers: { age: 72 }, query: '個人情況', planIds: ['A'],
      docChecks: { [key]: true, '已移除資源文件': true }, stepDone: { A: [0], B: [0] } };
    const payload = savedPlan(s, [item]);
    expect(payload.docChecks).toEqual({ [key]: true });
    expect(payload.stepDone).toEqual({ A: [0] });
    expect(JSON.stringify(payload)).not.toMatch(/answers|query|age|個人情況|realName/);
  });

  it('以 PUT 與 revision 儲存；異常資料及衝突不當成成功', async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => new Response(JSON.stringify(response(plan(['A']), 1))));
    const api = new PlanApi(fetcher);
    await api.write(plan(['A']), 0);
    expect(fetcher.mock.calls[0]![0]).toContain('/api/personal-action-plan');
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ plan: plan(['A']), revision: 0 });
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'PUT', cache: 'no-store', keepalive: true });
    await expect(new PlanApi(async () => new Response('{}')).read()).rejects.toBeInstanceOf(PlanError);
    await expect(new PlanApi(async () => new Response(JSON.stringify(response({ ...plan(['A']), target: 'other' })))).read()).rejects.toBeInstanceOf(PlanError);
    await expect(new PlanApi(async () => new Response('', { status: 409 })).write(plan(), 0)).rejects.toMatchObject({ status: 409 });
  });
});

describe('資料庫同步', () => {
  function fixture(initial = plan()) {
    let current = initial;
    let revision = 0;
    const writes: SavedPlan[] = [];
    const api = {
      read: vi.fn(async () => response(current, revision)),
      write: vi.fn(async (p: SavedPlan) => { writes.push(p); return response(p, ++revision); }),
    };
    const sync = new ActionPlanSync(() => current, p => { current = p; }, api as unknown as PlanApi);
    return { sync, api, writes, get current() { return current; }, set current(p: SavedPlan) { current = p; } };
  }
  it('重新開啟先還原項目、文件和步驟，不用空畫面覆寫資料庫', async () => {
    const saved = { ...plan(['A']), docChecks: { document: true }, stepDone: { A: [0] } };
    const f = fixture();
    f.api.read.mockResolvedValue(response(saved, 4));
    await f.sync.load();
    expect(f.current).toEqual(saved);
    expect(f.api.write).not.toHaveBeenCalled();
    expect(f.sync.state.phase).toBe('saved');
  });
  it('寫入期間的新修改依序送出，較舊回覆不覆寫最新選擇', async () => {
    const f = fixture(); await f.sync.load();
    let finish!: (r: PlanResponse) => void;
    f.api.write.mockImplementationOnce(() => new Promise<PlanResponse>(resolve => { finish = resolve; }));
    f.current = plan(['A']); f.sync.changed();
    f.current = plan(['A', 'B']); f.sync.changed();
    expect(f.api.write).toHaveBeenCalledTimes(1);
    expect(f.sync.state.phase).toBe('saving');
    finish(response(plan(['A']), 1));
    await f.sync.flush();
    expect(f.api.write).toHaveBeenCalledTimes(2);
    expect(f.api.write.mock.calls[1]![0]).toEqual(plan(['A', 'B']));
    expect(f.current.planIds).toEqual(['A', 'B']);
    expect(f.sync.state.phase).toBe('saved');
  });
  it('資料庫失敗保留本頁修改並顯示失敗，明確重試後才標記已保存', async () => {
    const f = fixture(); await f.sync.load();
    f.api.write.mockRejectedValueOnce(new PlanError(500));
    f.current = plan(['A']); f.sync.changed(); await f.sync.flush();
    expect(f.current.planIds).toEqual(['A']); expect(f.sync.state.phase).toBe('error');
    await f.sync.retry();
    expect(f.sync.state.phase).toBe('saved');
  });
  it('版本衝突不自動覆寫另一個視窗，須明確載入最新行動單', async () => {
    const f = fixture(); await f.sync.load();
    f.api.write.mockRejectedValueOnce(new PlanError(409));
    f.current = plan(['A']); f.sync.changed(); await f.sync.flush();
    f.current = plan(['A', 'B']); f.sync.changed();
    expect(f.sync.state.phase).toBe('conflict'); expect(f.api.write).toHaveBeenCalledTimes(1);
    f.api.read.mockResolvedValue(response(plan(['C']), 9));
    await f.sync.load(true);
    expect(f.current.planIds).toEqual(['C']);
  });
  it('首次讀取失敗期間的修改不會被重試默默覆寫', async () => {
    const f = fixture(); f.api.read.mockRejectedValueOnce(new PlanError(0)); await f.sync.load();
    f.current = plan(['local']); f.sync.changed();
    f.api.read.mockResolvedValue(response(plan(['remote']), 2));
    await f.sync.retry();
    expect(f.current.planIds).toEqual(['local']); expect(f.sync.state.phase).toBe('conflict');
    expect(f.api.write).not.toHaveBeenCalled();
  });
  it('讀取尚未完成就更改清單時，不用稍後到達的回覆蓋掉本頁修改', async () => {
    const f = fixture(); let finish!: (r: PlanResponse) => void;
    f.api.read.mockImplementationOnce(() => new Promise<PlanResponse>(resolve => { finish = resolve; }));
    const loading = f.sync.load();
    f.current = plan(['local']); f.sync.changed();
    finish(response(plan(['remote']), 3)); await loading;
    expect(f.current.planIds).toEqual(['local']); expect(f.sync.state.phase).toBe('conflict');
    expect(f.api.write).not.toHaveBeenCalled();
  });
});
