import { describe, expect, it } from 'vitest';
import reviewed from '../../content/deadline-summaries.json';
import { deadlineSummary } from '../deadline';
import { buildRoute } from '../route';
import { planProgress } from '../plan-progress';
import { realItem } from './real-data';
import { makeSubsidy } from './fixtures';

describe('期限摘要與完整來源', () => {
  it('學海方案日期優先，保留學校與年度，不把校例當全國期限', () => {
    for (const id of ['WEL-0033', 'WEL-0034']) {
      const item = realItem(id);
      expect(deadlineSummary(item)).toBe('2027/01/29 截止（限臺北市立大學116年度）');
      expect(buildRoute(item).deadline).toBe(item.application.deadline.raw);
      expect(planProgress(item, {}, {}, {}).deadline).toBe(deadlineSummary(item));
    }
  });
  it('保留原文精確時分，不補上不存在的時間', () => {
    expect(deadlineSummary(realItem('CT-0019'))).toBe('2026/01/01 09:00～2026/12/31 17:00');
    expect(deadlineSummary(realItem('WEL-0128'))).toContain('2026/11/30 12:00（臺北時間）');
    expect(deadlineSummary(realItem('WEL-0033'))).not.toContain('23:59');
  });
  it('公告日、給付期間、分梯次及個案時效不誤作統一截止日', () => {
    expect(deadlineSummary(realItem('WEL-0037'))).toBe('依各社宅招租公告');
    expect(deadlineSummary(realItem('CT-0023'))).toContain('非申請截止日');
    expect(deadlineSummary(realItem('WEL-0051'))).toContain('購買後6個月內');
    expect(deadlineSummary(realItem('WEL-0140'))).toContain('AI研發第2梯次');
  });
  it('審閱摘要全部綁定目前期限原文，資料變更後不顯示舊日期', () => {
    for (const [id, entry] of Object.entries(reviewed)) {
      expect(entry.source).toEqual(realItem(id).application.deadline);
      expect(deadlineSummary(realItem(id))).toBe(entry.summary);
    }
    const changed = structuredClone(realItem('WEL-0033'));
    changed.application.deadline = { type: 'unknown', start: null, end: null, raw: '新年度尚待公告' };
    expect(deadlineSummary(changed)).toBe('新年度尚待公告');
  });
  it('缺少日期才用短文字，原文仍完整保留', () => {
    const item = makeSubsidy({ application: { deadline: { type: 'unknown', start: null, end: null, raw: null } } });
    expect(deadlineSummary(item)).toBe('申請期限待確認');
    item.application.deadline.raw = '常態受理，無截止日（第三方摘要）';
    expect(deadlineSummary(item)).toBe('常態受理');
    expect(buildRoute(item).deadline).toBe(item.application.deadline.raw);
  });
});
