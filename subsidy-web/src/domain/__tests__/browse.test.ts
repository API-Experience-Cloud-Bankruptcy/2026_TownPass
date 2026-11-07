import { describe, expect, it } from 'vitest';
import { BROWSE_CATEGORIES, browseCatalog, browseCategory, browseStatus, browseStatusLabel } from '../browse';
import { loadSnapshot } from '../catalog';
import { makeSubsidy } from './fixtures';

const today = '2026-11-08';
const dated = (start: string | null, end: string | null) => makeSubsidy({ application: { deadline: { type: 'fixed', start, end, raw: '' } } });

describe('補助總覽的時效與完整分類', () => {
  it('臺北日期含截止當日，未到開始日與已截止均隱藏', () => {
    expect(browseStatus(dated(null, today), today)).toBe('available');
    expect(browseStatus(dated(null, '2026-11-07'), today)).toBe('closed');
    expect(browseStatus(dated('2026-11-09', '2026-12-01'), today)).toBe('upcoming');
  });
  it('複合年度截止公告也隱藏；混合學校與梯次保留待確認', () => {
    for (const status of ['115年度已截止；後續年度待公告', '115第二階段已截止且額滿；追蹤下年度', '115額度已用罄']) {
      expect(browseStatus(makeSubsidy({ source_meta: { application_status: status } }), today)).toBe('closed');
    }
    expect(browseStatus(makeSubsidy({ source_meta: { application_status: '116常態第一期尚未開放' } }), today)).toBe('upcoming');
    expect(browseStatus(makeSubsidy({ source_meta: { application_status: '116國際交流第1期受理中；常態第1期已截止' } }), today)).toBe('uncertain');
  });
  it('期限不明預設不列出，勾選可看；仍不列已截止項目', () => {
    const unknown = makeSubsidy({ id: 'unknown', application: { deadline: { type: 'yearly', end: null } } });
    const expired = dated(null, '2026-11-07');
    expect(browseCatalog([unknown, expired], { today })).toEqual([]);
    expect(browseCatalog([unknown, expired], { today, includeUncertain: true })).toEqual([unknown]);
  });
  it('勾選後可查尚未開放的項目，排在可申請項目之後；已截止一律不列', () => {
    const open = makeSubsidy({ id: 'open', application: { deadline: { type: 'ongoing', end: null } } });
    const expired = { ...dated(null, '2026-11-07'), id: 'expired' };
    const later = { ...dated('2026-11-09', '2026-12-01'), id: 'later' };
    expect(browseCatalog([expired, later, open], { today }).map(i => i.id)).toEqual(['open']);
    expect(browseCatalog([expired, later, open], { today, includeUncertain: true, includeUpcoming: true }).map(i => i.id)).toEqual(['open', 'later']);
    expect(browseStatusLabel(expired, today)).toBe('已截止（2026-11-07）');
    expect(browseStatusLabel(later, today)).toBe('尚未開放（2026-11-09 起）');
  });
  it('217 筆均恰有一個分類，分類聯集等於整份可瀏覽資料，不遺漏其他福利', async () => {
    const { items } = await loadSnapshot();
    const all = browseCatalog(items, { today, includeUncertain: true });
    const groups = BROWSE_CATEGORIES.flatMap(c => browseCatalog(items, { today, category: c.id, includeUncertain: true }));
    expect(new Set(groups.map(i => i.id)).size).toBe(all.length);
    expect(groups.length).toBe(all.length);
    expect(items.every(i => BROWSE_CATEGORIES.some(c => c.id === browseCategory(i)))).toBe(true);
  });
  it('名稱優先排序、臺台相通、多詞取交集，分類與時效共同生效，不修改輸入資料', () => {
    const title = makeSubsidy({ id: 'title', name: '臺北租屋補助', classification: { category: '住宅' } });
    const body = makeSubsidy({ id: 'body', name: '租屋方案', search: { text: '台北住宅' }, classification: { category: '住宅' } });
    const closed = makeSubsidy({ id: 'closed', name: '台北租屋', application: { deadline: { end: '2026-11-07' } } });
    const data = [body, title, closed];
    const before = JSON.stringify(data);
    expect(browseCatalog(data, { today, query: '台北　租屋', category: 'housing' }).map(i => i.id)).toEqual(['title', 'body']);
    expect(browseCatalog(data, { today, query: '台北 托育' })).toEqual([]);
    expect(browseCatalog(data, { today, query: '台北', category: 'study' })).toEqual([]);
    expect(JSON.stringify(data)).toBe(before);
  });
});
