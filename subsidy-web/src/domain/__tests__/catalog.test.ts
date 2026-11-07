import { describe, expect, it } from 'vitest';
import { fnv1a64, loadCatalog, loadSnapshot, snapshotVersion, validateCatalog } from '../catalog';
import { evaluateAll } from '../match';
import { loadQuestions } from '../questions';
import { filterCatalog } from '../situations';
import { makeSubsidy } from './fixtures';

const snapshot = async () => ({ version: 'snap', items: [makeSubsidy()] });
const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('資料載入與備援', () => {
  it('API 正常時使用 API', async () => {
    const c = await loadCatalog({ fetchImpl: () => json({ version: 'v1', items: [makeSubsidy()] }), snapshot, base: '' });
    expect(c.origin).toBe('api');
    expect(c.version).toBe('v1');
  });
  it('API 失敗、錯誤狀態或畸形資料時改用快照並說明原因', async () => {
    const cases = [
      () => Promise.reject(new TypeError('network')),
      () => json({}, 500),
      () => json({ version: 'v1', items: [{ id: 'X', name: 'n' }] }),
      () => json({ version: 'v1', items: [{ ...makeSubsidy(), scope: { level: 'x', regions: '臺北市' } }] }),
      () => json({ version: 'v1', items: [{ ...makeSubsidy(), application: { ...makeSubsidy().application, required_documents: null } }] }),
      () => json({ version: 'v1', items: [makeSubsidy(), makeSubsidy()] }),
    ];
    for (const fetchImpl of cases) {
      const c = await loadCatalog({ fetchImpl, snapshot, base: '' });
      expect(c.origin).toBe('snapshot');
      expect(c.fallbackReason).toBeTruthy();
    }
  });
  it('API 逾時改用快照', async () => {
    const hang = (_: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('a'), { name: 'AbortError' }))));
    const c = await loadCatalog({ fetchImpl: hang, snapshot, base: '', timeoutMs: 10 });
    expect(c.fallbackReason).toBe('API 逾時');
  });
  it('題庫 API 逾時改用本機模板', async () => {
    const hang = (_: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('abort'))));
    const bank = await loadQuestions([makeSubsidy()], { fetchImpl: hang, base: '', timeoutMs: 10 });
    expect(bank.origin).toBe('local');
  });
  it('raw 可為 null 仍通過驗證', () => {
    const item = makeSubsidy({ eligibility: { age: [{ raw: null, min: 1, max: null, subject: '申請人', unit: 'year' }], raw_summary: null } } as any);
    expect(validateCatalog({ version: 'v', items: [item] }).ok).toBe(true);
  });
});

describe('FNV-1a 64 指紋', () => {
  it('與標準測試向量一致', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
    expect(snapshotVersion('a')).toBe('catalog-v1-af63dc4c8601ec8c');
  });
});

describe('建置快照（backend/data/subsidies.json 原始檔）', () => {
  it('217 筆、未裁切欄位、全部通過驗證', async () => {
    const c = await loadSnapshot();
    expect(c.items).toHaveLength(217);
    expect(c.version).toMatch(/^catalog-v1-[0-9a-f]{16}$/);
    const wel1 = c.items.find((i) => i.id === 'WEL-0001')!;
    expect(wel1.eligibility.income[0]).toHaveProperty('period', 'year');
    expect(wel1.eligibility.income[0]).toHaveProperty('year', null);
    expect(wel1).toHaveProperty('merge');
  });

  it('代表資料：全部未知時沒有任何不符或 likely', async () => {
    const c = await loadSnapshot();
    const results = [...evaluateAll(c.items, {}).values()];
    expect(results.every((r) => r.fit === 'possible')).toBe(true);
  });

  it('長者情境：72 歲不會排除含替代條件的長者資源，且不產生 likely', async () => {
    const c = await loadSnapshot();
    const elder = filterCatalog(c.items, 'elder', '');
    expect(elder.length).toBeGreaterThan(0);
    const results = evaluateAll(elder, { age: 72, region: '臺北市' });
    expect([...results.values()].some((r) => r.fit === 'likely')).toBe(false);
  });

  it('學生情境：搜尋助學金可找到資料', async () => {
    const c = await loadSnapshot();
    const hits = filterCatalog(c.items, 'study', '助學金');
    expect(hits.some((i) => i.id === 'WEL-0001')).toBe(true);
  });
});
